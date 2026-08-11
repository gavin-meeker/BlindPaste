// Carries plaintext from an already-decrypted paste into a fresh create form, when the
// reader chooses to reuse it as a starting point. This is the only channel that can do
// that: "Create a paste" is a plain `<a href="/">`, a full page load that drops any
// in-memory React state, so the handoff has to survive a navigation.
//
// sessionStorage, not the URL. A query string ends up in access logs and browser
// history the moment it is used, and the whole design elsewhere in this app — the key
// living in a fragment instead — exists to avoid exactly that. sessionStorage never
// leaves the browser, is scoped to the tab, and disappears when the tab closes.
//
// Wrapped in try/catch because storage access can throw — some private-browsing modes
// disable it outright. Failing to prefill is a minor inconvenience; failing to load the
// page over it would not be.

const DRAFT_KEY = 'blindpaste:draft'

export function saveDraft(text: string): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, text)
  } catch {
    // No prefill on the other end. Not worth surfacing.
  }
}

/** Reads and clears in one step, so a later reload of "/" starts blank rather than
 *  replaying a stale draft. */
export function takeDraft(): string | null {
  try {
    const draft = sessionStorage.getItem(DRAFT_KEY)
    if (draft !== null) {
      sessionStorage.removeItem(DRAFT_KEY)
    }
    return draft
  } catch {
    return null
  }
}
