import { describe, expect, it } from 'vitest'
import { bytesToBase64url } from '@/lib/base64url'
import { MalformedPayloadError } from '@/lib/errors'
import {
  buildHeader,
  decodePayload,
  HEADER_BYTES,
  IV_BYTES,
  packPayload,
  PAYLOAD_VERSION,
  SALT_BYTES,
  unpackPayload,
} from '@/lib/payload'

const salt = new Uint8Array(SALT_BYTES).fill(0x11)
const iv = new Uint8Array(IV_BYTES).fill(0x22)
const ciphertext = new Uint8Array(20).fill(0x33)

describe('buildHeader', () => {
  it('lays out version, salt and iv in order', () => {
    const header = buildHeader(salt, iv)

    expect(header.length).toBe(HEADER_BYTES)
    expect(header[0]).toBe(PAYLOAD_VERSION)
    expect(header.subarray(1, 1 + SALT_BYTES)).toEqual(salt)
    expect(header.subarray(1 + SALT_BYTES)).toEqual(iv)
  })
})

describe('packPayload / unpackPayload', () => {
  it('round-trips every field', () => {
    const unpacked = unpackPayload(packPayload(buildHeader(salt, iv), ciphertext))

    expect(unpacked.version).toBe(PAYLOAD_VERSION)
    expect(unpacked.salt).toEqual(salt)
    expect(unpacked.iv).toEqual(iv)
    expect(unpacked.ciphertext).toEqual(ciphertext)
    expect(unpacked.header).toEqual(buildHeader(salt, iv))
  })

  it('produces a URL-safe token', () => {
    expect(packPayload(buildHeader(salt, iv), ciphertext)).not.toMatch(/[+/=]/)
  })

  it('rejects a payload that is not base64url', () => {
    expect(() => unpackPayload('not a payload!')).toThrow(MalformedPayloadError)
  })

  it('rejects a payload shorter than a header plus a GCM tag', () => {
    // 29 header bytes + 16 tag bytes is the floor; 44 is one short.
    const tooShort = bytesToBase64url(new Uint8Array(44))

    expect(() => unpackPayload(tooShort)).toThrow(MalformedPayloadError)
  })

  it('accepts the minimum valid length', () => {
    const minimum = new Uint8Array(HEADER_BYTES + 16)
    minimum[0] = PAYLOAD_VERSION

    expect(() => unpackPayload(bytesToBase64url(minimum))).not.toThrow()
  })

  it('rejects an unknown version', () => {
    const bytes = new Uint8Array(HEADER_BYTES + 16)
    bytes[0] = PAYLOAD_VERSION + 1

    expect(() => unpackPayload(bytesToBase64url(bytes))).toThrow(MalformedPayloadError)
  })

  it('rejects an empty payload', () => {
    expect(() => unpackPayload('')).toThrow(MalformedPayloadError)
  })
})

describe('decodePayload', () => {
  it('reports the fields in a readable form', () => {
    const decoded = decodePayload(packPayload(buildHeader(salt, iv), ciphertext))

    expect(decoded.version).toBe(PAYLOAD_VERSION)
    expect(decoded.salt).toBe(bytesToBase64url(salt))
    expect(decoded.iv).toBe(bytesToBase64url(iv))
    expect(decoded.ciphertextBytes).toBe(ciphertext.length)
  })
})
