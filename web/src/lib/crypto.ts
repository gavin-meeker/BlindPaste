// Client-side encryption. Nothing here touches the network or the DOM: it turns
// a string into a key plus an opaque payload and back again, and the caller
// decides that the key belongs in the URL fragment and the payload goes to the
// API.
//
// Two factors are required to read a paste: a random 256-bit key and an optional
// passphrase. Both are fed into one KDF, so a leaked URL is useless without the
// passphrase and a guessed passphrase is useless without the URL.
//
// Requires a secure context — crypto.subtle is unavailable outside HTTPS and
// localhost.

import { base64urlToBytes, bytesToBase64url } from './base64url'
import { DecryptFailedError, MalformedKeyError } from './errors'
import { buildHeader, IV_BYTES, packPayload, SALT_BYTES, unpackPayload } from './payload'

export const KEY_BYTES = 32

// OWASP's floor for PBKDF2-HMAC-SHA-256. The random key alone already makes the
// derived key unguessable; these iterations exist to slow passphrase guessing by
// someone who already holds the URL.
const PBKDF2_ITERATIONS = 600_000

export type EncryptResult = {
  /** base64url, 43 characters. Belongs in the URL fragment — never send it anywhere. */
  key: string
  /** base64url. Safe to store server-side; it is meaningless without the key. */
  payload: string
}

/**
 * Stretches the random key and passphrase into one AES-GCM key.
 *
 * This runs whether or not a passphrase was supplied. Skipping it when there is
 * no passphrase would be safe — a 256-bit random key needs no stretching — but
 * it would make the work observably different for protected pastes and add a
 * branch that has to stay correct forever.
 */
async function deriveKey(
  keyBytes: Uint8Array,
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const passphraseBytes = new TextEncoder().encode(passphrase)

  // The key is a fixed 32 bytes, so plain concatenation is unambiguous.
  const material = new Uint8Array(keyBytes.length + passphraseBytes.length)
  material.set(keyBytes, 0)
  material.set(passphraseBytes, keyBytes.length)

  const baseKey = await crypto.subtle.importKey('raw', material, 'PBKDF2', false, ['deriveKey'])

  // TypeScript's DOM lib types BufferSource as requiring an ArrayBuffer-backed
  // view specifically, but `salt` here (like every Uint8Array this module
  // receives from payload.ts) is typed as the more general ArrayBufferLike. A
  // fresh copy is concretely ArrayBuffer-backed and satisfies the stricter type;
  // the copy is a few bytes and irrelevant to performance next to 600k PBKDF2
  // rounds.
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new Uint8Array(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptText(
  plaintext: string,
  passphrase = '',
): Promise<EncryptResult> {
  const keyBytes = crypto.getRandomValues(new Uint8Array(KEY_BYTES))
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))

  const derivedKey = await deriveKey(keyBytes, passphrase, salt)

  // The header is authenticated but not encrypted, so altering the version, salt
  // or iv fails decryption instead of silently changing how it is interpreted.
  const header = buildHeader(salt, iv)

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new Uint8Array(header) },
      derivedKey,
      new TextEncoder().encode(plaintext),
    ),
  )

  return {
    key: bytesToBase64url(keyBytes),
    payload: packPayload(header, ciphertext),
  }
}

export async function decryptText(
  payload: string,
  key: string,
  passphrase = '',
): Promise<string> {
  const { salt, iv, ciphertext, header } = unpackPayload(payload)

  let keyBytes: Uint8Array
  try {
    keyBytes = base64urlToBytes(key)
  } catch {
    throw new MalformedKeyError('Key is not valid base64url.')
  }

  if (keyBytes.length !== KEY_BYTES) {
    throw new MalformedKeyError(`Key is ${keyBytes.length} bytes; expected ${KEY_BYTES}.`)
  }

  const derivedKey = await deriveKey(keyBytes, passphrase, salt)

  let plaintextBytes: ArrayBuffer
  try {
    plaintextBytes = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv), additionalData: new Uint8Array(header) },
      derivedKey,
      new Uint8Array(ciphertext),
    )
  } catch {
    // A wrong key, a wrong passphrase and a tampered payload all land here and
    // cannot be told apart. Do not guess at which one it was.
    throw new DecryptFailedError(
      'Could not decrypt: wrong key, wrong passphrase, or the paste was altered.',
    )
  }

  return new TextDecoder().decode(plaintextBytes)
}
