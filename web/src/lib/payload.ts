// The wire format. A paste is one opaque base64url token laid out as:
//
//   byte  0      version
//   bytes 1-16   salt      (PBKDF2)
//   bytes 17-28  iv        (AES-GCM)
//   bytes 29+    ciphertext followed by the 16-byte GCM tag
//
// The API stores this token in a single text column and never parses it, so any
// change to the crypto parameters above is a frontend-only change. The version
// byte is what keeps such a change from breaking pastes already stored.

import { base64urlToBytes, bytesToBase64url } from './base64url'
import { MalformedPayloadError } from './errors'

export const PAYLOAD_VERSION = 1
export const SALT_BYTES = 16
export const IV_BYTES = 12

const VERSION_BYTES = 1
const TAG_BYTES = 16

export const HEADER_BYTES = VERSION_BYTES + SALT_BYTES + IV_BYTES

const SALT_OFFSET = VERSION_BYTES
const IV_OFFSET = SALT_OFFSET + SALT_BYTES

// Even an empty plaintext produces a 16-byte GCM tag.
const MIN_PAYLOAD_BYTES = HEADER_BYTES + TAG_BYTES

// The views below are annotated Uint8Array<ArrayBuffer> rather than plain
// Uint8Array because Web Crypto's BufferSource requires a concretely
// ArrayBuffer-backed view. Every one of these is already backed by an
// ArrayBuffer; saying so lets crypto.ts pass them straight through.
export type UnpackedPayload = {
  version: number
  salt: Uint8Array<ArrayBuffer>
  iv: Uint8Array<ArrayBuffer>
  ciphertext: Uint8Array<ArrayBuffer>
  /** version, salt and iv as one slice — passed to AES-GCM as authenticated data. */
  header: Uint8Array<ArrayBuffer>
}

export function buildHeader(salt: Uint8Array, iv: Uint8Array): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(HEADER_BYTES)
  header[0] = PAYLOAD_VERSION
  header.set(salt, SALT_OFFSET)
  header.set(iv, IV_OFFSET)

  return header
}

export function packPayload(header: Uint8Array, ciphertext: Uint8Array): string {
  const bytes = new Uint8Array(header.length + ciphertext.length)
  bytes.set(header, 0)
  bytes.set(ciphertext, header.length)

  return bytesToBase64url(bytes)
}

export function unpackPayload(payload: string): UnpackedPayload {
  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = base64urlToBytes(payload)
  } catch (err) {
    throw new MalformedPayloadError('Payload is not valid base64url.', { cause: err })
  }

  if (bytes.length < MIN_PAYLOAD_BYTES) {
    throw new MalformedPayloadError(
      `Payload is ${bytes.length} bytes, short of the ${MIN_PAYLOAD_BYTES}-byte minimum.`,
    )
  }

  const version = bytes[0]
  if (version !== PAYLOAD_VERSION) {
    throw new MalformedPayloadError(
      `Unsupported payload version ${version}; this build reads version ${PAYLOAD_VERSION}.`,
    )
  }

  return {
    version,
    salt: bytes.subarray(SALT_OFFSET, SALT_OFFSET + SALT_BYTES),
    iv: bytes.subarray(IV_OFFSET, HEADER_BYTES),
    ciphertext: bytes.subarray(HEADER_BYTES),
    header: bytes.subarray(0, HEADER_BYTES),
  }
}

/**
 * Debugging aid: the payload's public fields in a readable form. Nothing in the
 * app depends on this — it exists so an opaque token is still inspectable from a
 * console when something looks wrong.
 */
export function decodePayload(payload: string): {
  version: number
  salt: string
  iv: string
  ciphertextBytes: number
} {
  const { version, salt, iv, ciphertext } = unpackPayload(payload)

  return {
    version,
    salt: bytesToBase64url(salt),
    iv: bytesToBase64url(iv),
    ciphertextBytes: ciphertext.length,
  }
}
