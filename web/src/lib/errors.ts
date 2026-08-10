// The failures this module can produce. They are distinct types so a caller can
// tell a corrupt payload from a bad key from a failed decryption without
// matching on message text.

/** The stored payload is not a payload this build can read. */
export class MalformedPayloadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MalformedPayloadError'
  }
}

/** The supplied key string is not a well-formed key. */
export class MalformedKeyError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MalformedKeyError'
  }
}

/**
 * Authentication failed. Wrong key, wrong passphrase and tampered ciphertext are
 * cryptographically indistinguishable, so this covers all three — never report
 * one of them specifically.
 *
 * Unlike the errors above this one takes no `cause`, on purpose: the underlying
 * Web Crypto failure is dropped so nothing downstream can start distinguishing
 * the three cases from it.
 */
export class DecryptFailedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DecryptFailedError'
  }
}

/**
 * Web Crypto is unavailable. `crypto.subtle` only exists in a secure context, so
 * the page was served over plain HTTP from something other than localhost. This
 * is an environment problem, not a problem with the paste — the UI should say so
 * rather than reporting a decryption failure.
 */
export class InsecureContextError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InsecureContextError'
  }
}
