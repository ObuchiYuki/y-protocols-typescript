import { Observable } from 'lib0/observable';
import * as Y from 'yjs';
export type MetaClientState = {
    clock: number;
    lastUpdated: number;
};
export type AwarenessUpdate = {
    added: number[];
    updated: number[];
    removed: number[];
};
export type State = {
    [Key in string]: any;
};
export declare const outdatedTimeout = 30000;
export interface Awareness {
    on(name: "update", block: (update: AwarenessUpdate) => void): void;
    on(name: "change", block: (update: AwarenessUpdate) => void): void;
    on(name: "destroy", block: () => void): void;
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
export declare class Awareness extends Observable<string> {
    document: Y.Doc;
    clientID: number;
    states: Map<number, State>;
    meta: Map<number, MetaClientState>;
    private _checkTimer;
    constructor(document: Y.Doc);
    get localState(): State | null;
    set localState(state: State | null);
    setLocalStateField(field: string, value: any): void;
    /**
     * Mark (remote) clients as inactive and remove them from the list of active peers.
     * This change will be propagated to remote clients.
     */
    removeStates(clients: number[], origin: unknown): void;
    /**
     * Modify the content of an awareness update before re-encoding it to an awareness update.
     *
     * This might be useful when you have a central server that wants to ensure that clients
     * cant hijack somebody elses identity.
     */
    modifyUpdate(update: Uint8Array, modify: (value: unknown) => unknown): Uint8Array;
    applyUpdate(update: Uint8Array, origin: unknown): void;
    encodeUpdate(clients: number[], states?: Map<number, State>): Uint8Array | undefined;
    destroy(): void;
}
