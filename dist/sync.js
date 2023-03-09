"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readSyncMessage = exports.readUpdate = exports.writeUpdate = exports.readSyncStep2 = exports.readSyncStep1 = exports.writeSyncStep2 = exports.writeSyncStep1 = exports.MessageType = void 0;
const Y = require("yjs");
var MessageType;
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
})(MessageType = exports.MessageType || (exports.MessageType = {}));
/**
 * Create a sync step 1 message based on the state of the current shared document.
 */
const writeSyncStep1 = (encoder, doc) => {
    encoder.writeVarUint(MessageType.syncStep1);
    const sv = Y.encodeStateVector(doc);
    encoder.writeVarUint8Array(sv);
};
exports.writeSyncStep1 = writeSyncStep1;
const writeSyncStep2 = (encoder, doc, encodedStateVector) => {
    encoder.writeVarUint(MessageType.syncStep2);
    encoder.writeVarUint8Array(Y.encodeStateAsUpdate(doc, encodedStateVector));
};
exports.writeSyncStep2 = writeSyncStep2;
/**
 * Read SyncStep1 message and reply with SyncStep2.
 *
 * decoder: The reply to the received message
 * encoder: The received message
 */
const readSyncStep1 = (decoder, encoder, doc) => (0, exports.writeSyncStep2)(encoder, doc, decoder.readVarUint8Array());
exports.readSyncStep1 = readSyncStep1;
/**
 * Read and apply Structs and then DeleteStore to a y instance.
 */
const readSyncStep2 = (decoder, doc, transactionOrigin) => {
    try {
        Y.applyUpdate(doc, decoder.readVarUint8Array(), transactionOrigin);
    }
    catch (error) {
        // This catches errors that are thrown by event handlers
        console.error('Caught error while handling a Yjs update', error);
    }
};
exports.readSyncStep2 = readSyncStep2;
const writeUpdate = (encoder, update) => {
    encoder.writeVarUint(MessageType.update);
    encoder.writeVarUint8Array(update);
};
exports.writeUpdate = writeUpdate;
/**
 * Read and apply Structs and then DeleteStore to a y instance.
 */
exports.readUpdate = exports.readSyncStep2;
/**
 * @param decoder: A message received from another client
 * @param encoder: The reply message. Will not be sent if empty.
 * @param doc:
 * @param transactionOrigin:
 */
const readSyncMessage = (decoder, encoder, doc, transactionOrigin) => {
    const messageType = decoder.readVarUint();
    if (messageType == MessageType.syncStep1) {
        (0, exports.readSyncStep1)(decoder, encoder, doc);
    }
    else if (messageType == MessageType.syncStep2) {
        (0, exports.readSyncStep2)(decoder, doc, transactionOrigin);
    }
    else if (messageType == MessageType.update) {
        (0, exports.readUpdate)(decoder, doc, transactionOrigin);
    }
    else {
        throw new Error('Unknown message type');
    }
    return messageType;
};
exports.readSyncMessage = readSyncMessage;
