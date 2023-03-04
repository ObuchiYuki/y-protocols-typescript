import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
export const messagePermissionDenied = 0;
export const writePermissionDenied = (encoder, reason) => {
    encoding.writeVarUint(encoder, messagePermissionDenied);
    encoding.writeVarString(encoder, reason);
};
export const readAuthMessage = (decoder, y, permissionDeniedHandler) => {
    switch (decoding.readVarUint(decoder)) {
        case messagePermissionDenied: permissionDeniedHandler(y, decoding.readVarString(decoder));
    }
};
