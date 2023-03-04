import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as time from 'lib0/time';
import * as math from 'lib0/math';
import { Observable } from 'lib0/observable';
import * as f from 'lib0/function';
// ============================================================================================ //
// MARK: Const
export const outdatedTimeout = 30000;
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
export class Awareness extends Observable {
    constructor(document) {
        super();
        // Maps from client id to client state
        this.states = new Map();
        this.meta = new Map();
        this.document = document;
        this.clientID = document.clientID;
        this._checkTimer = (setInterval(() => {
            const now = time.getUnixTime();
            const meta = this.meta.get(this.clientID);
            if (meta == null)
                return;
            if (this.localState !== null && outdatedTimeout / 2 <= now - meta.lastUpdated) {
                // renew local clock
                this.localState = this.localState;
            }
            const remove = [];
            this.meta.forEach((meta, clientid) => {
                if (clientid !== this.clientID && outdatedTimeout <= now - meta.lastUpdated && this.states.has(clientid)) {
                    remove.push(clientid);
                }
            });
            if (remove.length > 0) {
                this.removeStates(remove, 'timeout');
            }
        }, math.floor(outdatedTimeout / 10)));
        document.on('destroy', () => { this.destroy(); });
        this.localState = {};
    }
    get localState() {
        return this.states.get(this.clientID) || null;
    }
    set localState(state) {
        const clientID = this.clientID;
        const currLocalMeta = this.meta.get(clientID);
        const clock = currLocalMeta === undefined ? 0 : currLocalMeta.clock + 1;
        const prevState = this.states.get(clientID);
        if (state == null) {
            this.states.delete(clientID);
        }
        else {
            this.states.set(clientID, state);
        }
        this.meta.set(clientID, { clock: clock, lastUpdated: time.getUnixTime() });
        const added = [];
        const updated = [];
        const filteredUpdated = [];
        const removed = [];
        if (state === null) {
            removed.push(clientID);
        }
        else if (prevState == null) {
            if (state != null) {
                added.push(clientID);
            }
        }
        else {
            updated.push(clientID);
            if (!f.equalityDeep(prevState, state)) {
                filteredUpdated.push(clientID);
            }
        }
        if (added.length > 0 || filteredUpdated.length > 0 || removed.length > 0) {
            this.emit('change', [{ added, updated: filteredUpdated, removed }, 'local']);
        }
        this.emit('update', [{ added, updated, removed }, 'local']);
    }
    setLocalStateField(field, value) {
        const state = this.localState;
        if (state !== null) {
            this.localState = Object.assign(Object.assign({}, state), { [field]: value });
        }
    }
    /**
     * Mark (remote) clients as inactive and remove them from the list of active peers.
     * This change will be propagated to remote clients.
     */
    removeStates(clients, origin) {
        const removed = [];
        for (let i = 0; i < clients.length; i++) {
            const clientID = clients[i];
            if (!this.states.has(clientID))
                continue;
            this.states.delete(clientID);
            if (clientID === this.clientID) {
                const curMeta = this.meta.get(clientID);
                if (curMeta == null)
                    continue;
                this.meta.set(clientID, { clock: curMeta.clock + 1, lastUpdated: time.getUnixTime() });
            }
            removed.push(clientID);
        }
        if (removed.length > 0) {
            this.emit('change', [{ added: [], updated: [], removed }, origin]);
            this.emit('update', [{ added: [], updated: [], removed }, origin]);
        }
    }
    /**
     * Modify the content of an awareness update before re-encoding it to an awareness update.
     *
     * This might be useful when you have a central server that wants to ensure that clients
     * cant hijack somebody elses identity.
     */
    modifyUpdate(update, modify) {
        const decoder = decoding.createDecoder(update);
        const encoder = encoding.createEncoder();
        const len = decoding.readVarUint(decoder);
        encoding.writeVarUint(encoder, len);
        for (let i = 0; i < len; i++) {
            const clientID = decoding.readVarUint(decoder);
            const clock = decoding.readVarUint(decoder);
            const state = JSON.parse(decoding.readVarString(decoder));
            const modifiedState = modify(state);
            encoding.writeVarUint(encoder, clientID);
            encoding.writeVarUint(encoder, clock);
            encoding.writeVarString(encoder, JSON.stringify(modifiedState));
        }
        return encoding.toUint8Array(encoder);
    }
    applyUpdate(update, origin) {
        const decoder = decoding.createDecoder(update);
        const timestamp = time.getUnixTime();
        const added = [];
        const updated = [];
        const filteredUpdated = [];
        const removed = [];
        const len = decoding.readVarUint(decoder);
        for (let i = 0; i < len; i++) {
            const clientID = decoding.readVarUint(decoder);
            let clock = decoding.readVarUint(decoder);
            const state = JSON.parse(decoding.readVarString(decoder));
            const clientMeta = this.meta.get(clientID);
            const prevState = this.states.get(clientID);
            const currClock = clientMeta === undefined ? 0 : clientMeta.clock;
            if (currClock < clock || (currClock === clock && state === null && this.states.has(clientID))) {
                if (state === null) {
                    // never let a remote client remove this local state
                    if (clientID === this.clientID && this.localState != null) {
                        // remote client removed the local state. Do not remote state. Broadcast a message indicating
                        // that this client still exists by increasing the clock
                        clock++;
                    }
                    else {
                        this.states.delete(clientID);
                    }
                }
                else {
                    this.states.set(clientID, state);
                }
                this.meta.set(clientID, { clock: clock, lastUpdated: timestamp });
                if (clientMeta === undefined && state !== null) {
                    added.push(clientID);
                }
                else if (clientMeta !== undefined && state === null) {
                    removed.push(clientID);
                }
                else if (state !== null) {
                    if (!f.equalityDeep(state, prevState)) {
                        filteredUpdated.push(clientID);
                    }
                    updated.push(clientID);
                }
            }
        }
        if (added.length > 0 || filteredUpdated.length > 0 || removed.length > 0) {
            this.emit('change', [{ added, updated: filteredUpdated, removed }, origin]);
        }
        if (added.length > 0 || updated.length > 0 || removed.length > 0) {
            this.emit('update', [{ added, updated, removed }, origin]);
        }
    }
    encodeUpdate(clients, states = this.states) {
        var _a;
        const len = clients.length;
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, len);
        for (let i = 0; i < len; i++) {
            const clientID = clients[i];
            const state = states.get(clientID) || null;
            const clock = (_a = this.meta.get(clientID)) === null || _a === void 0 ? void 0 : _a.clock;
            if (clock == null)
                return;
            encoding.writeVarUint(encoder, clientID);
            encoding.writeVarUint(encoder, clock);
            encoding.writeVarString(encoder, JSON.stringify(state));
        }
        return encoding.toUint8Array(encoder);
    }
    destroy() {
        this.emit('destroy', [this]);
        this.localState = null;
        super.destroy();
        clearInterval(this._checkTimer);
    }
}
