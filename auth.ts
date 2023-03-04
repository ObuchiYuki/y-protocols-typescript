
import * as Y from 'yjs' // eslint-disable-line
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

export const messagePermissionDenied = 0

export const writePermissionDenied = (encoder: encoding.Encoder, reason: string) => {
  encoding.writeVarUint(encoder, messagePermissionDenied)
  encoding.writeVarString(encoder, reason)
}

export const readAuthMessage = (decoder: decoding.Decoder, y: Y.Doc, permissionDeniedHandler: (y: Y.Doc, reason: string) => void) => {
  switch (decoding.readVarUint(decoder)) {
    case messagePermissionDenied: permissionDeniedHandler(y, decoding.readVarString(decoder))
  }
}
