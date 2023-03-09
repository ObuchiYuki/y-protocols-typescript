import * as Y from 'yjs';
import * as lib0 from 'lib0-typescript';
export type StateMap = Map<number, number>;
/**
 * Core Yjs defines two message types:
 * • YjsSyncStep1: Includes the State Set of the sending client. When received, the client should reply with YjsSyncStep2.
 * • YjsSyncStep2: Includes all missing structs and the complete delete set. When received, the client is assured that it
 *  received all information from the remote client.
 
  In a peer-to-peer network, you may want to introduce a SyncDone message type. Both parties should initiate the connection
  with SyncStep1. When a client received SyncStep2, it should reply with SyncDone. When the local client received both
  SyncStep2 and SyncDone, it is assured that it is synced to the remote client.
 
  In a client-server model, you want to handle this differently: The client should initiate the connection with SyncStep1.
  When the server receives SyncStep1, it should reply with SyncStep2 immediately followed by SyncStep1. The client replies
  with SyncStep2 when it receives SyncStep1. Optionally the server may send a SyncDone after it received SyncStep2, so the
  client knows that the sync is finished. There are two reasons for this more elaborated sync model: 1. This protocol can
  easily be implemented on top of http and websockets. 2. The server shoul only reply to requests, and not initiate them.
  Therefore it is necesarry that the client initiates the sync.
 
  Construction of a message:
  [messageType : varUint, message definition..]
 
  Note: A message does not include information about the room name. This must to be handled by the upper layer protocol!
 
  stringify[messageType] stringifies a message definition (messageType is already read from the bufffer)
 */
export type MessageType = typeof MessageType.syncStep1 | typeof MessageType.syncStep2 | typeof MessageType.update;
export declare module MessageType {
    const syncStep1 = 0;
    const syncStep2 = 1;
    const update = 2;
    const toString: (value: MessageType) => string;
}
/**
 * Create a sync step 1 message based on the state of the current shared document.
 */
export declare const writeSyncStep1: (encoder: lib0.Encoder, doc: Y.Doc) => void;
export declare const writeSyncStep2: (encoder: lib0.Encoder, doc: Y.Doc, encodedStateVector?: Uint8Array) => void;
/**
 * Read SyncStep1 message and reply with SyncStep2.
 *
 * decoder: The reply to the received message
 * encoder: The received message
 */
export declare const readSyncStep1: (decoder: lib0.Decoder, encoder: lib0.Encoder, doc: Y.Doc) => void;
/**
 * Read and apply Structs and then DeleteStore to a y instance.
 */
export declare const readSyncStep2: (decoder: lib0.Decoder, doc: Y.Doc, transactionOrigin: unknown) => void;
export declare const writeUpdate: (encoder: lib0.Encoder, update: Uint8Array) => void;
/**
 * Read and apply Structs and then DeleteStore to a y instance.
 */
export declare const readUpdate: (decoder: lib0.Decoder, doc: Y.Doc, transactionOrigin: unknown) => void;
/**
 * @param decoder: A message received from another client
 * @param encoder: The reply message. Will not be sent if empty.
 * @param doc:
 * @param transactionOrigin:
 */
export declare const readSyncMessage: (decoder: lib0.Decoder, encoder: lib0.Encoder, doc: Y.Doc, transactionOrigin: unknown) => 0 | 1 | 2;
