
import * as Y from 'yjs'
import * as lib0 from 'lib0-typescript'

export const messagePermissionDenied = 0

export const writePermissionDenied = (encoder: lib0.Encoder, reason: string) => {
  encoder.writeVarUint(messagePermissionDenied)
  encoder.writeVarString(reason)
}

export const readAuthMessage = (decoder: lib0.Decoder, y: Y.Doc, permissionDeniedHandler: (y: Y.Doc, reason: string) => void) => {
  switch (decoder.readVarUint()) {
    case messagePermissionDenied: permissionDeniedHandler(y, decoder.readVarString())
  }
}
