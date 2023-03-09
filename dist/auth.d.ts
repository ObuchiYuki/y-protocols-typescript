import * as Y from 'yjs';
import * as lib0 from 'lib0-typescript';
export declare const messagePermissionDenied = 0;
export declare const writePermissionDenied: (encoder: lib0.Encoder, reason: string) => void;
export declare const readAuthMessage: (decoder: lib0.Decoder, y: Y.Doc, permissionDeniedHandler: (y: Y.Doc, reason: string) => void) => void;
