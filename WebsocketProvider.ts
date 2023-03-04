import * as Y from 'yjs'

import * as bc from 'lib0/broadcastchannel'
import * as url from 'lib0/url'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { Observable } from 'lib0/observable'

import * as sync from "./sync"
import * as auth from './auth'
import { Awareness, AwarenessUpdate } from './Awareness'
import { WebSocket, ErrorEvent, CloseEvent } from "ws"

// ============================================================================================ //
// MARK: Type
export type BroadcastSubscriber = (data: ArrayBuffer, origin: any) => void
export type MessageType = typeof MessageType.sync | typeof MessageType.queryAwareness | typeof MessageType.awareness | typeof MessageType.auth
export type ConnectionStatus = "connected"|"connecting"|"disconnected"
export type Config = {
    connectOnLaunch?: boolean, 
    WebSocketClass?: typeof WebSocket, 
    resyncInterval?: number,
    maxBackoffTime?: number, 
    enableBroadcast?: boolean
}

// ============================================================================================ //
// MARK: Consts

export module MessageType {
    export const sync = 0
    export const queryAwareness = 3
    export const awareness = 1
    export const auth = 2

    export const toString = (type: MessageType) => {
        switch (type) {
            case MessageType.sync: return "sync"
            case MessageType.queryAwareness: return "queryAwareness"
            case MessageType.awareness: return "awareness"
            case MessageType.auth: return "auth"
        }
    }
}

const messageReconnectTimeout = 30000

// ============================================================================================ //
// MARK: WebsocketProvider
// ============================================================================================ //
export interface WebSocketProvider {
    on(name: "synced", func: (synced: boolean) => void): void
    on(name: "sync", func: (synced: boolean) => void): void
    on(name: "connection-error", func: (event: ErrorEvent) => void): void
    on(name: "connection-close", func: (event: CloseEvent) => void): void
    on(name: "status", func: (status: { status: ConnectionStatus }) => void): void
}

export class WebSocketProvider extends Observable<string> {

    // ============================================================================================ //
    // MARK: Properties
    url: string
    roomname: string
    document: Y.Doc
    awareness: Awareness
    
    webSocketConnected: boolean = false
    webSocketConnecting: boolean = false
    webSocketUnsuccessfulReconnects: number = 0
    webSocketLastMessageReceived: number = 0
    socket: WebSocket | null = null
    
    broadcastChannel: string
    broadcastConnected: boolean = false

    get synced() { return this._synced }

    set synced(value) {
        if (this._synced === value) return
        this._synced = value
        this.emit('sync', [value])
        if (value) this.emit('synced', [value]);
    }

    private _config: {
        connectOnLaunch: boolean,
        webSocketClass: typeof WebSocket, 
        resyncInterval: number,
        maxBackoffTime: number, 
        enableBroadcast: boolean
    }
    private _synced: boolean = false
    private _shouldConnect = true

    private _resyncTimer: NodeJS.Timer | undefined 
    private _checkTimer: NodeJS.Timer

    private _broadcastSubscriber: (data: ArrayBuffer, origin: any) => void
    private _updateHandler: (update: Uint8Array, origin: any) => void
    private _awarenessUpdateHandler: (update: AwarenessUpdate, _origin: any) => void
    private _unloadHandler: () => void

    // ============================================================================================ //
    // MARK: Init
    constructor ({ serverUrl, roomname, params = {}, doc, config = {} }: { serverUrl: string, roomname: string, params?: { [Key in string]: string }, doc: Y.Doc, config?: Config }) {
        super()
        
        while (serverUrl[serverUrl.length - 1] === '/') {
            serverUrl = serverUrl.slice(0, serverUrl.length - 1)
        }
        
        this.broadcastChannel = serverUrl + '/' + roomname
        const encodedParams = url.encodeQueryParams(params)

        this.url = serverUrl + '/' + roomname + (encodedParams.length === 0 ? '' : '?' + encodedParams)
        this.roomname = roomname
        this.document = doc
        this.awareness = new Awareness(doc)
        this._config = {
            connectOnLaunch: config.connectOnLaunch ?? true,
            webSocketClass: config.WebSocketClass ?? WebSocket,
            resyncInterval: config.resyncInterval ?? -1,
            maxBackoffTime: config.maxBackoffTime ?? 2500,
            enableBroadcast: config.enableBroadcast ?? true
        }
        this._shouldConnect = this._config.connectOnLaunch

        this._resyncTimer = this.makeResyncTimer(config.resyncInterval ?? -1)
        this._broadcastSubscriber = this.makeBroadcastSubscriber()
        this._updateHandler = this.makeUpdateHandler()
        this._awarenessUpdateHandler = this.makeAwarenessHandler(this.awareness)
        this._unloadHandler = this.makeUnloadHandler()
        this._checkTimer = this.makeCheckTimer()
        
        if (this._config.connectOnLaunch ?? true) { this.connectWebSocket() }
    }

    // ============================================================================================ //
    // MARK: Methods
    destroy() {
        if (this._resyncTimer != null) { clearInterval(this._resyncTimer) }
        clearInterval(this._checkTimer)

        this.disconnect()
        if (typeof window !== 'undefined') {
            window.removeEventListener('unload', this._unloadHandler)
        } else if (typeof process !== 'undefined') {
            process.off('exit', this._unloadHandler)
        }
        this.awareness.off('update', this._awarenessUpdateHandler)
        this.document.off('update', this._updateHandler)
        super.destroy()
    }

    disconnect() {
        this._shouldConnect = false
        this.disconnectBroadcast()
        if (this.socket != null) { this.socket.close()  }
    }

    connectWebSocket() {
        this._shouldConnect = true
        if (!this.webSocketConnected && this.socket === null) {
            this.setupWebsocket()
            this.connectBroadcast()
        }
    }

    // ============================================================================================ //
    // MARK: Read Message

    private readMessage(buffer: Uint8Array, emitSynced: boolean) {
        const decoder = decoding.createDecoder(buffer)
        const encoder = encoding.createEncoder()
        const messageType = decoding.readVarUint(decoder) as MessageType

        if (messageType == MessageType.sync) {
            this.readMessageSync(encoder, decoder, emitSynced)
        } else if (messageType == MessageType.queryAwareness) {
            this.readMessageQueryAwareness(encoder)
        } else if (messageType == MessageType.awareness) {
            this.readMessageAwareness(decoder)
        } else if (messageType == MessageType.auth) {
            this.readMessageAuth(decoder)
        } else {
            console.error('Unable to compute message', messageType)
        }
        return encoder
    }

    private readMessageSync(encoder: encoding.Encoder, decoder: decoding.Decoder, emitSynced: boolean) {
        encoding.writeVarUint(encoder, MessageType.sync)
        const syncMessageType = sync.readSyncMessage(decoder, encoder, this.document, this)
        
        if (emitSynced && syncMessageType === sync.MessageType.syncStep2 && !this.synced) {
            this.synced = true
        }
    }

    private readMessageQueryAwareness(encoder: encoding.Encoder) {
        encoding.writeVarUint(encoder, MessageType.awareness)
        const data = this.awareness.encodeUpdate(
            Array.from(this.awareness.states.keys())
        )
        if (data != null) {
            encoding.writeVarUint8Array(encoder, data)
        }
    }

    private readMessageAwareness(decoder: decoding.Decoder) {
        this.awareness.applyUpdate(decoding.readVarUint8Array(decoder), this)
    }

    private readMessageAuth(decoder: decoding.Decoder) {
        auth.readAuthMessage(decoder, this.document, (_, reason) => {
            console.warn(`Permission denied to access ${this.url}.\n${reason}`)
        })
    }

    // ============================================================================================ //
    // MARK: Private methods
    private setupWebsocket() {
        if (!this._shouldConnect || this.socket != null) return

        const socket = new this._config.webSocketClass(this.url)
        socket.binaryType = 'arraybuffer'
        this.socket = socket
        this.webSocketConnecting = true
        this.webSocketConnected = false
        this.synced = false

        socket.onmessage = (event) => {
            this.webSocketLastMessageReceived = Date.now()
            const data = new Uint8Array(event.data as any)
            const encoder = this.readMessage(data, true)
            if (encoding.length(encoder) > 1) {
                socket.send(encoding.toUint8Array(encoder))
            }
        }
        socket.onerror = (event) => {
            this.emit('connection-error', [event, this])
        }
        socket.onclose = (event) => {
            this.emit('connection-close', [event, this])
            this.socket = null
            this.webSocketConnecting = false

            if (this.webSocketConnected) {
                this.webSocketConnected = false
                this.synced = false
                // update awareness (all users except local left)
                this.awareness.removeStates(
                    Array.from(this.awareness.states.keys()).filter((client) => client !== this.document.clientID), this
                )
                this.emit('status', [{ status: 'disconnected' }])
            } else {
                this.webSocketUnsuccessfulReconnects++
            }
            
            const nextTime = Math.min(Math.pow(2, this.webSocketUnsuccessfulReconnects) * 100, this._config.maxBackoffTime)
            setTimeout(() => { this.setupWebsocket() }, nextTime)
        }
        socket.onopen = () => {
            this.webSocketLastMessageReceived = Date.now()
            this.webSocketConnecting = false
            this.webSocketConnected = true
            this.webSocketUnsuccessfulReconnects = 0
            this.emit('status', [{ status: 'connected' }])
            
            // always send sync step 1 when connected
            const encoder = encoding.createEncoder()
            encoding.writeVarUint(encoder, MessageType.sync)
            sync.writeSyncStep1(encoder, this.document)
            socket.send(encoding.toUint8Array(encoder), error => {
                if (error != null) socket.close()
            })
            
            // broadcast local awareness state
            if (this.awareness.localState !== null) {
                const encoderAwarenessState = encoding.createEncoder()
                encoding.writeVarUint(encoderAwarenessState, MessageType.awareness)
                const data = this.awareness.encodeUpdate([this.document.clientID])
                if (data == null) return
                encoding.writeVarUint8Array(encoderAwarenessState, data)
                socket.send(encoding.toUint8Array(encoderAwarenessState))
            }
        }

        this.emit('status', [{ status: 'connecting' }])
    }

    private broadcastMessageBoth(buffer: ArrayBuffer) {
        if (this.webSocketConnected) { this.socket?.send(buffer) }
        if (this.broadcastConnected) { bc.publish(this.broadcastChannel, buffer, this) }
    }

    // ============================================= //
    // MARK: Broadcast connection
    private connectBroadcast() {
        if (!this._config.enableBroadcast) return

        if (!this.broadcastConnected) {
            bc.subscribe(this.broadcastChannel, this._broadcastSubscriber)
            this.broadcastConnected = true
        }

        // send sync step1 to bc
        // write sync step 1
        const encoderSync = encoding.createEncoder()
        encoding.writeVarUint(encoderSync, MessageType.sync)
        sync.writeSyncStep1(encoderSync, this.document)
        bc.publish(this.broadcastChannel, encoding.toUint8Array(encoderSync), this)
        
        // broadcast local state
        const encoderState = encoding.createEncoder()
        encoding.writeVarUint(encoderState, MessageType.sync)
        sync.writeSyncStep2(encoderState, this.document)
        bc.publish(this.broadcastChannel, encoding.toUint8Array(encoderState), this)
        
        // write queryAwareness
        const encoderAwarenessQuery = encoding.createEncoder()
        encoding.writeVarUint(encoderAwarenessQuery, MessageType.queryAwareness)
        bc.publish(this.broadcastChannel, encoding.toUint8Array(encoderAwarenessQuery), this)

        // broadcast local awareness state
        const encoderAwarenessState = encoding.createEncoder()
        encoding.writeVarUint(encoderAwarenessState, MessageType.awareness)
        const data = this.awareness.encodeUpdate([this.document.clientID])
        if (data == null) return
        encoding.writeVarUint8Array(encoderAwarenessState, data)
        bc.publish(this.broadcastChannel, encoding.toUint8Array(encoderAwarenessState), this)
    }

    private disconnectBroadcast() {
        // broadcast message with local awareness state set to null (indicating disconnect)
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, MessageType.awareness)
        const data = this.awareness.encodeUpdate([this.document.clientID], new Map())
        if (data == null) return
        encoding.writeVarUint8Array(encoder, data)
        this.broadcastMessageBoth(encoding.toUint8Array(encoder))
        if (this.broadcastConnected) {
            bc.unsubscribe(this.broadcastChannel, this._broadcastSubscriber)
            this.broadcastConnected = false
        }
    }

    // ============================================= //
    // MARK: Handler init
    private makeResyncTimer(interval: number): NodeJS.Timer | undefined {
        if (interval <= 0) return
        
        const timer = setInterval(() => {
            if (this.socket?.readyState !== WebSocket.OPEN) return

            const encoder = encoding.createEncoder()
            encoding.writeVarUint(encoder, MessageType.sync)
            sync.writeSyncStep1(encoder, this.document)
            this.socket.send(encoding.toUint8Array(encoder))
        }, interval)

        return timer
    }

    private makeBroadcastSubscriber(): (data: ArrayBuffer, origin: any) => void {
        return (data: ArrayBuffer, origin: any) => {
            if (origin === this) return
            const encoder = this.readMessage(new Uint8Array(data), false)
            if (encoding.length(encoder) <= 1) return
            bc.publish(this.broadcastChannel, encoding.toUint8Array(encoder), this)
        }
    }

    private makeUpdateHandler(): (update: Uint8Array, origin: any) => void {
        const handler = (update: Uint8Array, origin: any) => {
            if (origin === this) return
            const encoder = encoding.createEncoder()
            encoding.writeVarUint(encoder, MessageType.sync)
            sync.writeUpdate(encoder, update)
            this.broadcastMessageBoth(encoding.toUint8Array(encoder))
        }
        this.document.on('update', handler)
        return handler
    }

    private makeAwarenessHandler(awareness: Awareness) {
        const handler = ({ added, updated, removed }: AwarenessUpdate) => {
            const changedClients = added.concat(updated).concat(removed)
            const encoder = encoding.createEncoder()
            encoding.writeVarUint(encoder, MessageType.awareness)
            const data = awareness.encodeUpdate(changedClients)
            if (data == null) return
            encoding.writeVarUint8Array(encoder, data)
            this.broadcastMessageBoth(encoding.toUint8Array(encoder))
        }
        awareness.on('update', handler)
        return handler
    }

    private makeUnloadHandler() {
        const handler = () => {
            this.awareness.removeStates([this.document.clientID], 'window unload')
        }

        if (typeof window !== 'undefined') {
            window.addEventListener('unload', handler)
        } else if (typeof process !== 'undefined') {
            process.on('exit', handler)
        }
        
        return handler
    }

    private makeCheckTimer(): NodeJS.Timer {
        return setInterval(() => {
            if (this.webSocketConnected && messageReconnectTimeout < Date.now() - this.webSocketLastMessageReceived) {
                this.socket?.close()
            }
        }, messageReconnectTimeout / 10)
    }
}

