import { describe, expect, it } from 'vitest'
import { base64urlToBytes, bytesToBase64url } from '@/lib/base64url'
import { decryptText, encryptText, KEY_BYTES } from '@/lib/crypto'
import { DecryptFailedError, MalformedKeyError, MalformedPayloadError } from '@/lib/errors'
import { HEADER_BYTES, IV_BYTES, SALT_BYTES } from '@/lib/payload'

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
