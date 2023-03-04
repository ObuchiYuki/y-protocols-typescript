import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as Y from 'yjs';
export var MessageType;
(function (MessageType) {
    MessageType.syncStep1 = 0;
    MessageType.syncStep2 = 1;
    MessageType.update = 2;
    MessageType.toString = (value) => {
        switch (value) {
            case MessageType.syncStep1: return "syncStep1";
            case MessageType.syncStep2: return "syncStep2";
            case MessageType.update: return "update";
        }
    };
})(MessageType || (MessageType = {}));
/**
 * Create a sync step 1 message based on the state of the current shared document.
 */
export const writeSyncStep1 = (encoder, doc) => {
    encoding.writeVarUint(encoder, MessageType.syncStep1);
    const sv = Y.encodeStateVector(doc);
    encoding.writeVarUint8Array(encoder, sv);
};
export const writeSyncStep2 = (encoder, doc, encodedStateVector) => {
    encoding.writeVarUint(encoder, MessageType.syncStep2);
    encoding.writeVarUint8Array(encoder, Y.encodeStateAsUpdate(doc, encodedStateVector));
};
/**
 * Read SyncStep1 message and reply with SyncStep2.
 *
 * decoder: The reply to the received message
 * encoder: The received message
 */
export const readSyncStep1 = (decoder, encoder, doc) => writeSyncStep2(encoder, doc, decoding.readVarUint8Array(decoder));
/**
 * Read and apply Structs and then DeleteStore to a y instance.
 */
export const readSyncStep2 = (decoder, doc, transactionOrigin) => {
    try {
        Y.applyUpdate(doc, decoding.readVarUint8Array(decoder), transactionOrigin);
    }
    catch (error) {
        // This catches errors that are thrown by event handlers
        console.error('Caught error while handling a Yjs update', error);
    }
};
export const writeUpdate = (encoder, update) => {
    encoding.writeVarUint(encoder, MessageType.update);
    encoding.writeVarUint8Array(encoder, update);
};
/**
 * Read and apply Structs and then DeleteStore to a y instance.
 */
export const readUpdate = readSyncStep2;
/**
 * @param decoder: A message received from another client
 * @param encoder: The reply message. Will not be sent if empty.
 * @param doc:
 * @param transactionOrigin:
 */
export const readSyncMessage = (decoder, encoder, doc, transactionOrigin) => {
    const messageType = decoding.readVarUint(decoder);
    if (messageType == MessageType.syncStep1) {
        readSyncStep1(decoder, encoder, doc);
    }
    else if (messageType == MessageType.syncStep2) {
        readSyncStep2(decoder, doc, transactionOrigin);
    }
    else if (messageType == MessageType.update) {
        readUpdate(decoder, doc, transactionOrigin);
    }
    else {
        throw new Error('Unknown message type');
    }
    return messageType;
};
