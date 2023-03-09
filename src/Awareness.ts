import * as Y from 'yjs' 

import * as lib0 from "lib0-typescript"

// ============================================================================================ //
// MARK: Type
export type MetaClientState = { clock: number, lastUpdated: number  }
export type AwarenessUpdate = { added: number[], updated: number[], removed: number[] }
export type State = { [Key in string]: any }

// ============================================================================================ //
// MARK: Const
export const outdatedTimeout = 30000

// ============================================================================================ //
// MARK: Awareness
export interface Awareness {
    on(name: "update", block: (update: AwarenessUpdate, origin: unknown) => void): void
    on(name: "change", block: (update: AwarenessUpdate, origin: unknown) => void): void
    on(name: "destroy", block: () => void): void
}

/**
 * The Awareness class implements a simple shared state protocol that can be used for non-persistent data like awareness information
 * (cursor, username, status, ..). Each client can update its own local state and listen to state changes of
 * remote clients. Every client may set a state of a remote peer to `null` to mark the client as offline.
 *
 * Each client is identified by a unique client id (something we borrow from `doc.clientID`). A client can override
 * its own state by propagating a message with an increasing timestamp (`clock`). If such a message is received, it is
 * applied if the known state of that client is older than the new state (`clock < newClock`). If a client thinks that
 * a remote client is offline, it may propagate a message with
 * `{ clock: currentClientClock, state: null, client: remoteClient }`. If such a
 * message is received, and the known clock of that client equals the received clock, it will override the state with `null`.
 *
 * Before a client disconnects, it should propagate a `null` state with an updated clock.
 *
 * Awareness states must be updated every 30 seconds. Otherwise the Awareness instance will delete the client state.
 */
export class Awareness extends lib0.Observable<string> {
    document: Y.Doc
    clientID: number

    // Maps from client id to client state
    states: Map<number, State> = new Map()
    meta: Map<number, MetaClientState> = new Map()

    private _checkTimer: number | undefined

    constructor(document: Y.Doc) {
        super()
        this.document = document
        this.clientID = document.clientID
        
        this._checkTimer = (setInterval(() => {
            const now = Date.now()
            const meta = this.meta.get(this.clientID)
            if (meta == null) return

            if (this.localState !== null && outdatedTimeout / 2 <= now - meta.lastUpdated) {
                // renew local clock
                this.localState = this.localState
            }
            const remove: number[] = []
            this.meta.forEach((meta, clientid) => {
                if (clientid !== this.clientID && outdatedTimeout <= now - meta.lastUpdated && this.states.has(clientid)) {
                    remove.push(clientid)
                }
            })
            if (remove.length > 0) {
                this.removeStates(remove, 'timeout')
            }
        }, Math.floor(outdatedTimeout / 10)))

        document.on('destroy', () => { this.destroy() })
        this.localState = {}
    }

    get localState(): State|null { 
        return this.states.get(this.clientID) || null
    }

    set localState(state: State|null) { 
        const clientID = this.clientID
        const currLocalMeta = this.meta.get(clientID)
        const clock = currLocalMeta === undefined ? 0 : currLocalMeta.clock + 1
        const prevState = this.states.get(clientID)

        if (state == null) {
            this.states.delete(clientID)
        } else {
            this.states.set(clientID, state)
        }
        this.meta.set(clientID, { clock: clock, lastUpdated: Date.now() })

        const added: number[] = []
        const updated: number[] = []
        const filteredUpdated: number[] = []
        const removed: number[] = []
        if (state === null) {
            removed.push(clientID)
        } else if (prevState == null) {
            if (state != null) { added.push(clientID) }
        } else {
            updated.push(clientID)
            if (!lib0.isEqual(prevState, state)) { filteredUpdated.push(clientID) }
        }
        if (added.length > 0 || filteredUpdated.length > 0 || removed.length > 0) {
            this.emit('change', [{ added, updated: filteredUpdated, removed }, 'local'])
        }
        this.emit('update', [{ added, updated, removed }, 'local'])
    }

    setLocalStateField(field: string, value: any) {
        const state = this.localState
        if (state !== null) {
            this.localState = { ...state, [field]: value }
        }
    }

    /**
     * Mark (remote) clients as inactive and remove them from the list of active peers.
     * This change will be propagated to remote clients.
     */
    removeStates(clients: number[], origin: unknown){
        const removed: number[] = []
        for (let i = 0; i < clients.length; i++) {
            const clientID = clients[i]
            if (!this.states.has(clientID)) continue

            this.states.delete(clientID)
            if (clientID === this.clientID) {
                const curMeta = this.meta.get(clientID); 
                if (curMeta == null) continue
                this.meta.set(clientID, { clock: curMeta.clock + 1, lastUpdated: Date.now() })
            }
            removed.push(clientID)
        }
        if (removed.length > 0) {
            this.emit('change', [{ added: [], updated: [], removed }, origin])
            this.emit('update', [{ added: [], updated: [], removed }, origin])
        }
    }

    /**
     * Modify the content of an awareness update before re-encoding it to an awareness update.
     *
     * This might be useful when you have a central server that wants to ensure that clients
     * cant hijack somebody elses identity.
     */
    modifyUpdate(update: Uint8Array, modify: (value: unknown) => unknown): Uint8Array {
        const decoder = new lib0.Decoder(update)
        const encoder = new lib0.Encoder()
        const len = decoder.readVarUint()
        encoder.writeVarUint(len)
        for (let i = 0; i < len; i++) {
            const clientID = decoder.readVarUint()
            const clock = decoder.readVarUint()
            const state = JSON.parse(decoder.readVarString())
            const modifiedState = modify(state)
            encoder.writeVarUint(clientID)
            encoder.writeVarUint(clock)
            encoder.writeVarString(JSON.stringify(modifiedState))
        }
        return encoder.toUint8Array()
    }

    applyUpdate(update: Uint8Array, origin: unknown) {
        const decoder = new lib0.Decoder(update)
        const timestamp = Date.now()
        const added: number[] = []
        const updated: number[] = []
        const filteredUpdated: number[] = []
        const removed: number[] = []
        const len = decoder.readVarUint()

        for (let i = 0; i < len; i++) {
            const clientID = decoder.readVarUint()
            let clock = decoder.readVarUint()
            const state = JSON.parse(decoder.readVarString())
            const clientMeta = this.meta.get(clientID)
            const prevState = this.states.get(clientID)
            const currClock = clientMeta === undefined ? 0 : clientMeta.clock

            if (currClock < clock || (currClock === clock && state === null && this.states.has(clientID))) {
                if (state === null) {
                    // never let a remote client remove this local state
                    if (clientID === this.clientID && this.localState != null) {
                        // remote client removed the local state. Do not remote state. Broadcast a message indicating
                        // that this client still exists by increasing the clock
                        clock++
                    } else {
                        this.states.delete(clientID)
                    }
                } else {
                    this.states.set(clientID, state)
                }
                this.meta.set(clientID, { clock: clock, lastUpdated: timestamp })
                if (clientMeta === undefined && state !== null) {
                    added.push(clientID)
                } else if (clientMeta !== undefined && state === null) {
                    removed.push(clientID)
                } else if (state !== null) {
                    if (!lib0.isEqual(state, prevState)) { filteredUpdated.push(clientID) }
                    updated.push(clientID)
                }
            }
        }
        if (added.length > 0 || filteredUpdated.length > 0 || removed.length > 0) {
            this.emit('change', [{ added, updated: filteredUpdated, removed }, origin])
        }
        if (added.length > 0 || updated.length > 0 || removed.length > 0) {
            this.emit('update', [{ added, updated, removed }, origin])
        }
    }

    encodeUpdate(clients: number[], states = this.states): Uint8Array|undefined {
        const len = clients.length
        const encoder = new lib0.Encoder()
        encoder.writeVarUint(len)
        for (let i = 0; i < len; i++) {
            const clientID = clients[i]
            const state = states.get(clientID) || null
            const clock = this.meta.get(clientID)?.clock
            if (clock == null) return
            encoder.writeVarUint(clientID)
            encoder.writeVarUint(clock)
            encoder.writeVarString(JSON.stringify(state))
        }
        return encoder.toUint8Array()
    }

    destroy() {
        this.emit('destroy', [this])
        this.localState = null
        super.destroy()
        clearInterval(this._checkTimer)
    }
}

