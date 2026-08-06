import { describe, expect, it } from 'vitest'
import { base64urlToBytes, bytesToBase64url } from '@/lib/base64url'

describe('bytesToBase64url', () => {
  it('encodes a known value', () => {
    // "Hello" is 48 65 6c 6c 6f, which is "SGVsbG8=" in standard base64.
    const bytes = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f])

    expect(bytesToBase64url(bytes)).toBe('SGVsbG8')
  })

  it('encodes an empty array as an empty string', () => {
    expect(bytesToBase64url(new Uint8Array(0))).toBe('')
  })

  it('uses the URL-safe alphabet and drops padding', () => {
    // These three bytes encode to "+/++" in standard base64 — every character
    // that differs between the standard and URL-safe alphabets.
    const bytes = new Uint8Array([0xfb, 0xff, 0xbe])

    expect(bytesToBase64url(bytes)).toBe('-_--')
  })

  it('never emits +, / or = for any byte value', () => {
    const allBytes = new Uint8Array(256)
    for (let i = 0; i < 256; i += 1) {
      allBytes[i] = i
    }

    expect(bytesToBase64url(allBytes)).not.toMatch(/[+/=]/)
  })
})

describe('base64urlToBytes', () => {
  it('round-trips every byte value', () => {
    const allBytes = new Uint8Array(256)
    for (let i = 0; i < 256; i += 1) {
      allBytes[i] = i
    }

    expect(base64urlToBytes(bytesToBase64url(allBytes))).toEqual(allBytes)
  })

  it('round-trips inputs of every length modulo 4', () => {
    for (const length of [0, 1, 2, 3, 4, 5]) {
      const bytes = new Uint8Array(length).fill(0xab)

      expect(base64urlToBytes(bytesToBase64url(bytes))).toEqual(bytes)
    }
  })

  it('round-trips a large input', () => {
    const bytes = new Uint8Array(100_000).fill(0x7f)

    expect(base64urlToBytes(bytesToBase64url(bytes))).toEqual(bytes)
  })

  it('rejects characters outside the URL-safe alphabet', () => {
    expect(() => base64urlToBytes('abc!')).toThrow()
    expect(() => base64urlToBytes('ab+c')).toThrow()
    expect(() => base64urlToBytes('ab/c')).toThrow()
    expect(() => base64urlToBytes('SGVsbG8=')).toThrow()
  })

  it('rejects a length that cannot be valid base64', () => {
    // A base64 body can never be 1 more than a multiple of 4 characters.
    expect(() => base64urlToBytes('abcde')).toThrow()
  })
})
