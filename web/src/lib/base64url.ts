// Encoding helpers for moving raw bytes through URLs and JSON. base64url is the
// RFC 4648 §5 alphabet: '+' and '/' become '-' and '_', and padding is dropped,
// so the output is safe in a URL fragment without escaping.

// String.fromCharCode is applied to slices rather than the whole array because
// spreading a multi-megabyte array would blow the argument limit.
const CHUNK_SIZE = 0x8000

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export function bytesToBase64url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE))
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64urlToBytes(text: string): Uint8Array<ArrayBuffer> {
  // A base64 body is never 1 more than a multiple of 4 characters long, so that
  // length is rejected up front rather than left to atob's looser parsing.
  if (!BASE64URL_PATTERN.test(text) || text.length % 4 === 1) {
    throw new Error('Not valid base64url.')
  }

  // Only one encoding of a given byte string is accepted. When the length is not
  // a multiple of 4 the final character carries fewer than 6 bits of data and its
  // remaining low bits are spare; encoders emit them as zero but decoders
  // traditionally ignore them, so 'SGVsbG8', 'SGVsbG9', 'SGVsbG-' and 'SGVsbG_'
  // would all decode alike. Rejecting the non-zero forms keeps the encoding
  // one-to-one — a payload string is then a stable identity for its bytes — and
  // matches strict decoders elsewhere (Go's RawURLEncoding, Rust's base64), which
  // would otherwise reject tokens this module produced.
  const remainder = text.length % 4
  if (remainder !== 0) {
    const spareBits = remainder === 2 ? 0b1111 : 0b11
    const lastValue = BASE64URL_ALPHABET.indexOf(text[text.length - 1])

    if ((lastValue & spareBits) !== 0) {
      throw new Error('Not canonical base64url: trailing bits are not zero.')
    }
  }

  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))

  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }

  return bytes
}
