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
import { DecryptFailedError, InsecureContextError, MalformedKeyError } from './errors'
import { buildHeader, IV_BYTES, packPayload, SALT_BYTES, unpackPayload } from './payload'

// Re-exported so a consumer needs one import path. A viewer has to catch
// DecryptFailedError to tell "wrong passphrase, try again" from "this link is
// broken", which is the entire reason these are separate classes. errors.ts
// stays the definition site.
export {
  DecryptFailedError,
  InsecureContextError,
  MalformedKeyError,
  MalformedPayloadError,
} from './errors'

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
 * Fails early and legibly when Web Crypto is missing.
 *
 * `crypto.subtle` only exists in a secure context, so a page served over plain
 * HTTP from anything but localhost — a self-hosted instance reached at
 * `http://192.168.1.10:5173`, say — has no crypto at all. Without this the first
 * `crypto.subtle.importKey` throws a TypeError about reading a property of
 * undefined, which no caller can sensibly classify.
 */
function assertSecureContext(): void {
  if (!globalThis.crypto?.subtle) {
    throw new InsecureContextError(
      'Web Crypto is unavailable. BlindPaste needs a secure context — serve the page over HTTPS or from localhost.',
    )
  }
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
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const passphraseBytes = new TextEncoder().encode(passphrase)

  // The key is a fixed 32 bytes, so plain concatenation is unambiguous.
  const material = new Uint8Array(keyBytes.length + passphraseBytes.length)
  material.set(keyBytes, 0)
  material.set(passphraseBytes, keyBytes.length)

  const baseKey = await crypto.subtle.importKey('raw', material, 'PBKDF2', false, ['deriveKey'])

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * `passphrase` accepts null as well as undefined and treats both as "none".
 * `new FormData(form).get('passphrase')` yields `string | null`, and a null that
 * reached the encoder would stringify to the literal "null" — creating a paste
 * the UI believes is unprotected and that nobody can ever decrypt.
 *
 * Note on text: TextEncoder replaces an unpaired surrogate with U+FFFD, so a
 * string containing one (`'a\uD83D b'`) does not round-trip byte-for-byte. That
 * is inherent to encoding as UTF-8; such strings are not valid text and every
 * alternative encoding is worse.
 */
export async function encryptText(
  plaintext: string,
  passphrase?: string | null,
): Promise<EncryptResult> {
  assertSecureContext()

  const keyBytes = crypto.getRandomValues(new Uint8Array(KEY_BYTES))
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))

  const derivedKey = await deriveKey(keyBytes, passphrase ?? '', salt)

  // The header is authenticated but not encrypted, so altering the version, salt
  // or iv fails decryption instead of silently changing how it is interpreted.
  const header = buildHeader(salt, iv)

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: header },
      derivedKey,
      new TextEncoder().encode(plaintext),
    ),
  )

  return {
    key: bytesToBase64url(keyBytes),
    payload: packPayload(header, ciphertext),
  }
}

/** As with `encryptText`, a null passphrase means "none" rather than "null". */
export async function decryptText(
  payload: string,
  key: string,
  passphrase?: string | null,
): Promise<string> {
  assertSecureContext()

  const { salt, iv, ciphertext, header } = unpackPayload(payload)

  let keyBytes: Uint8Array<ArrayBuffer>
  try {
    keyBytes = base64urlToBytes(key)
  } catch (err) {
    throw new MalformedKeyError('Key is not valid base64url.', { cause: err })
  }

  if (keyBytes.length !== KEY_BYTES) {
    throw new MalformedKeyError(`Key is ${keyBytes.length} bytes; expected ${KEY_BYTES}.`)
  }

  const derivedKey = await deriveKey(keyBytes, passphrase ?? '', salt)

  let plaintextBytes: ArrayBuffer
  try {
    plaintextBytes = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: header },
      derivedKey,
      ciphertext,
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
