import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
export declare const messagePermissionDenied = 0;
export declare const writePermissionDenied: (encoder: encoding.Encoder, reason: string) => void;
export declare const readAuthMessage: (decoder: decoding.Decoder, y: Y.Doc, permissionDeniedHandler: (y: Y.Doc, reason: string) => void) => void;
