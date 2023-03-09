"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readAuthMessage = exports.writePermissionDenied = exports.messagePermissionDenied = void 0;
exports.messagePermissionDenied = 0;
const writePermissionDenied = (encoder, reason) => {
    encoder.writeVarUint(exports.messagePermissionDenied);
    encoder.writeVarString(reason);
};
exports.writePermissionDenied = writePermissionDenied;
const readAuthMessage = (decoder, y, permissionDeniedHandler) => {
    switch (decoder.readVarUint()) {
        case exports.messagePermissionDenied: permissionDeniedHandler(y, decoder.readVarString());
    }
};
exports.readAuthMessage = readAuthMessage;
