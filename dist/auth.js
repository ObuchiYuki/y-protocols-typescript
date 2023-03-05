"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readAuthMessage = exports.writePermissionDenied = exports.messagePermissionDenied = void 0;
const encoding = require("lib0/encoding");
const decoding = require("lib0/decoding");
exports.messagePermissionDenied = 0;
const writePermissionDenied = (encoder, reason) => {
    encoding.writeVarUint(encoder, exports.messagePermissionDenied);
    encoding.writeVarString(encoder, reason);
};
exports.writePermissionDenied = writePermissionDenied;
const readAuthMessage = (decoder, y, permissionDeniedHandler) => {
    switch (decoding.readVarUint(decoder)) {
        case exports.messagePermissionDenied: permissionDeniedHandler(y, decoding.readVarString(decoder));
    }
};
exports.readAuthMessage = readAuthMessage;
