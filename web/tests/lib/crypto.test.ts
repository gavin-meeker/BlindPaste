import { afterEach, describe, expect, it, vi } from 'vitest'
import { base64urlToBytes, bytesToBase64url } from '@/lib/base64url'
import { decryptText, encryptText, InsecureContextError, KEY_BYTES } from '@/lib/crypto'
import { DecryptFailedError, MalformedKeyError, MalformedPayloadError } from '@/lib/errors'
import { HEADER_BYTES, IV_BYTES, SALT_BYTES, unpackPayload } from '@/lib/payload'

function flipByteAt(payload: string, index: number): string {
  const bytes = base64urlToBytes(payload)
  bytes[index] ^= 0xff

  return bytesToBase64url(bytes)
}

describe('round-trip', () => {
  it('recovers the plaintext with no passphrase', async () => {
    const { key, payload } = await encryptText('attack at dawn')

    expect(await decryptText(payload, key)).toBe('attack at dawn')
  })

  it('recovers the plaintext with a passphrase', async () => {
    const { key, payload } = await encryptText('attack at dawn', 'hunter2')

    expect(await decryptText(payload, key, 'hunter2')).toBe('attack at dawn')
  })

  it('recovers unicode and emoji', async () => {
    const text = 'héllo → 世界 🔐'
    const { key, payload } = await encryptText(text)

    expect(await decryptText(payload, key)).toBe(text)
  })

  it('recovers an empty string', async () => {
    const { key, payload } = await encryptText('')

    expect(await decryptText(payload, key)).toBe('')
  })

  it('recovers a large document', async () => {
    const text = 'x'.repeat(1_000_000)
    const { key, payload } = await encryptText(text)

    expect(await decryptText(payload, key)).toBe(text)
  })
})

describe('null passphrase', () => {
  // `new FormData(form).get('passphrase')` is typed `string | null`, so a null
  // reaches these functions on an ordinary React path. It must mean "no
  // passphrase". If it were encoded instead, TextEncoder would stringify it to
  // the literal "null" and produce a paste nobody — including the creator, who
  // was never asked for a passphrase — could ever decrypt.
  it('encrypts with null exactly as it does with no passphrase', async () => {
    const { key, payload } = await encryptText('attack at dawn', null)

    expect(await decryptText(payload, key)).toBe('attack at dawn')
  })

  it('decrypts with null exactly as it does with no passphrase', async () => {
    const { key, payload } = await encryptText('attack at dawn')

    expect(await decryptText(payload, key, null)).toBe('attack at dawn')
  })

  it('does not treat null as the passphrase "null"', async () => {
    const { key, payload } = await encryptText('attack at dawn', null)

    await expect(decryptText(payload, key, 'null')).rejects.toThrow(DecryptFailedError)
  })
})

describe('key material', () => {
  it('returns a key that decodes to 32 bytes', async () => {
    const { key } = await encryptText('hello')

    expect(base64urlToBytes(key).length).toBe(KEY_BYTES)
    expect(key).not.toMatch(/[+/=]/)
  })

  it('never repeats a key, salt, iv or payload across calls', async () => {
    const first = await encryptText('same text')
    const second = await encryptText('same text')

    expect(first.key).not.toBe(second.key)
    expect(first.payload).not.toBe(second.payload)

    const firstBytes = base64urlToBytes(first.payload)
    const secondBytes = base64urlToBytes(second.payload)
    const saltOf = (b: Uint8Array) => bytesToBase64url(b.subarray(1, 1 + SALT_BYTES))
    const ivOf = (b: Uint8Array) => bytesToBase64url(b.subarray(1 + SALT_BYTES, HEADER_BYTES))

    expect(saltOf(firstBytes)).not.toBe(saltOf(secondBytes))
    expect(ivOf(firstBytes)).not.toBe(ivOf(secondBytes))
  })
})

describe('wrong credentials', () => {
  it('rejects a missing passphrase', async () => {
    const { key, payload } = await encryptText('secret', 'hunter2')

    await expect(decryptText(payload, key)).rejects.toThrow(DecryptFailedError)
  })

  it('rejects a wrong passphrase', async () => {
    const { key, payload } = await encryptText('secret', 'hunter2')

    await expect(decryptText(payload, key, 'hunter3')).rejects.toThrow(DecryptFailedError)
  })

  it('rejects an unexpected passphrase', async () => {
    const { key, payload } = await encryptText('secret')

    await expect(decryptText(payload, key, 'hunter2')).rejects.toThrow(DecryptFailedError)
  })

  it('rejects another paste\'s key', async () => {
    const { payload } = await encryptText('secret')
    const other = await encryptText('unrelated')

    await expect(decryptText(payload, other.key)).rejects.toThrow(DecryptFailedError)
  })
})

describe('tampering', () => {
  it('rejects a corrupted salt', async () => {
    const { key, payload } = await encryptText('secret')

    await expect(decryptText(flipByteAt(payload, 1), key)).rejects.toThrow(DecryptFailedError)
  })

  it('rejects a corrupted iv', async () => {
    const { key, payload } = await encryptText('secret')
    const ivIndex = 1 + SALT_BYTES

    await expect(decryptText(flipByteAt(payload, ivIndex), key)).rejects.toThrow(DecryptFailedError)
  })

  it('rejects a corrupted ciphertext', async () => {
    const { key, payload } = await encryptText('secret')

    await expect(decryptText(flipByteAt(payload, HEADER_BYTES), key)).rejects.toThrow(
      DecryptFailedError,
    )
  })

  it('rejects a corrupted gcm tag', async () => {
    const { key, payload } = await encryptText('secret')
    const lastIndex = base64urlToBytes(payload).length - 1

    await expect(decryptText(flipByteAt(payload, lastIndex), key)).rejects.toThrow(
      DecryptFailedError,
    )
  })

  it('rejects a corrupted version byte before decrypting', async () => {
    const { key, payload } = await encryptText('secret')

    // The version is validated ahead of decryption, so this surfaces as a
    // malformed payload rather than an authentication failure.
    await expect(decryptText(flipByteAt(payload, 0), key)).rejects.toThrow(MalformedPayloadError)
  })

  it('rejects a truncated payload', async () => {
    const { key, payload } = await encryptText('secret')
    const bytes = base64urlToBytes(payload)
    const truncated = bytesToBase64url(bytes.subarray(0, HEADER_BYTES + 8))

    await expect(decryptText(truncated, key)).rejects.toThrow(MalformedPayloadError)
  })
})

describe('bad inputs', () => {
  it('rejects a payload that is not base64url', async () => {
    const { key } = await encryptText('secret')

    await expect(decryptText('not a payload!', key)).rejects.toThrow(MalformedPayloadError)
  })

  it('rejects a key that is not base64url', async () => {
    const { payload } = await encryptText('secret')

    await expect(decryptText(payload, 'not a key!')).rejects.toThrow(MalformedKeyError)
  })

  it('rejects a key of the wrong length', async () => {
    const { payload } = await encryptText('secret')
    const shortKey = bytesToBase64url(new Uint8Array(16))

    await expect(decryptText(payload, shortKey)).rejects.toThrow(MalformedKeyError)
  })
})

describe('additional authenticated data', () => {
  // Guards the `additionalData` argument specifically, and is the only test that
  // does. Every test in `tampering` above would still pass if AAD were dropped
  // from crypto.ts, because each corrupted byte also breaks something else: a
  // changed salt changes the derived key, a changed IV changes GCM's IV, a
  // changed ciphertext or tag fails the tag, and a changed version is rejected
  // before decryption runs. Do not fold this into those tests.
  it('will not decrypt without the header as AAD', async () => {
    const { key, payload } = await encryptText('aad matters')
    const { salt, iv, ciphertext, header } = unpackPayload(payload)

    // Re-derive the same key the library used. With no passphrase the KDF input
    // is the key bytes alone. The iterations are fixed by the wire format.
    const baseKey = await crypto.subtle.importKey(
      'raw',
      base64urlToBytes(key),
      'PBKDF2',
      false,
      ['deriveKey'],
    )
    const derivedKey = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    )

    // Correct key, correct IV, no additionalData. This can only succeed if
    // encryption did not authenticate the header either.
    await expect(
      crypto.subtle.decrypt({ name: 'AES-GCM', iv }, derivedKey, ciphertext),
    ).rejects.toThrow()

    // The same call *with* the header succeeds — so the rejection above is about
    // the missing AAD and not a mistake in this test's key derivation.
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: header },
      derivedKey,
      ciphertext,
    )

    expect(new TextDecoder().decode(plaintext)).toBe('aad matters')
  })
})

describe('insecure context', () => {
  // crypto.subtle exists only in a secure context, so a self-hosted instance
  // opened at http://192.168.x.x:5173 has no Web Crypto at all. Without a guard
  // the first subtle call throws "Cannot read properties of undefined", which the
  // UI cannot classify.
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports a missing crypto global', async () => {
    vi.stubGlobal('crypto', undefined)

    await expect(encryptText('secret')).rejects.toThrow(InsecureContextError)
    await expect(decryptText('anything', 'anything')).rejects.toThrow(InsecureContextError)
  })

  it('reports a crypto global without subtle', async () => {
    // What a browser actually exposes over plain HTTP: getRandomValues is there,
    // subtle is not.
    vi.stubGlobal('crypto', { getRandomValues: <T>(array: T): T => array })

    await expect(encryptText('secret')).rejects.toThrow(InsecureContextError)
    await expect(decryptText('anything', 'anything')).rejects.toThrow(InsecureContextError)
  })

  it('checks before parsing, so a bad payload still reports the real problem', async () => {
    vi.stubGlobal('crypto', undefined)

    // 'not a payload!' would be a MalformedPayloadError in a secure context. The
    // environment is the actual fault, so that is what the caller must see.
    await expect(decryptText('not a payload!', 'not a key!')).rejects.toThrow(InsecureContextError)
  })

  it('restores the global, so later tests still have real crypto', () => {
    expect(globalThis.crypto.subtle).toBeDefined()
  })
})

describe('payload shape', () => {
  it('is exactly a header plus the ciphertext and tag', async () => {
    const { payload } = await encryptText('12345')
    const bytes = base64urlToBytes(payload)

    // 5 plaintext bytes + a 16-byte tag, after the 29-byte header.
    expect(bytes.length).toBe(HEADER_BYTES + 5 + 16)
    expect(HEADER_BYTES).toBe(1 + SALT_BYTES + IV_BYTES)
  })
})

describe('format stability', () => {
  // Captured from a known-good build. If this test fails, the wire format
  // changed and every paste already stored has become unreadable — bump
  // PAYLOAD_VERSION and keep a decrypt path for version 1 instead.
  const KNOWN_KEY = 'l-Pn3Wn-MoU2PlTCImr4X1fm3OdC0QpmlGznhqorlHM'
  const KNOWN_PAYLOAD =
    'ARTfbcVRErGmVdnNddWDKJ9FcnGVUcCpZJlv-LPmDkpj6lIveDgiBvRIrlnVFFYfmov9lKII8PSKmSNt1xH5Bmexfw'

  it('still decrypts a payload from an earlier build', async () => {
    expect(await decryptText(KNOWN_PAYLOAD, KNOWN_KEY, 'hunter2')).toBe('format stability check')
  })
})
