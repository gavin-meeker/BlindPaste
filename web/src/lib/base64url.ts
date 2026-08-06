// Encoding helpers for moving raw bytes through URLs and JSON. base64url is the
// RFC 4648 §5 alphabet: '+' and '/' become '-' and '_', and padding is dropped,
// so the output is safe in a URL fragment without escaping.

// String.fromCharCode is applied to slices rather than the whole array because
// spreading a multi-megabyte array would blow the argument limit.
const CHUNK_SIZE = 0x8000

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/

export function bytesToBase64url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE))
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64urlToBytes(text: string): Uint8Array {
  // A base64 body is never 1 more than a multiple of 4 characters long, so that
  // length is rejected up front rather than left to atob's looser parsing.
  if (!BASE64URL_PATTERN.test(text) || text.length % 4 === 1) {
    throw new Error('Not valid base64url.')
  }

  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))

  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }

  return bytes
}
