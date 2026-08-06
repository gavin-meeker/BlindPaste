// The failures this module can produce. They are distinct types so a caller can
// tell a corrupt payload from a bad key from a failed decryption without
// matching on message text.

/** The stored payload is not a payload this build can read. */
export class MalformedPayloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MalformedPayloadError'
  }
}

/** The supplied key string is not a well-formed key. */
export class MalformedKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MalformedKeyError'
  }
}

/**
 * Authentication failed. Wrong key, wrong passphrase and tampered ciphertext are
 * cryptographically indistinguishable, so this covers all three — never report
 * one of them specifically.
 */
export class DecryptFailedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DecryptFailedError'
  }
}
