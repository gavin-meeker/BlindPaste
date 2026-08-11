/**
 * Shared class strings for the handful of controls that repeat across screens.
 *
 * These are plain Tailwind utilities in a constant rather than `@apply` rules in
 * index.css. `@apply` is Tailwind's own last resort — it moves styling out of the
 * markup into a second place you have to go read, hides which utilities are in play,
 * and quietly loses variants unless every one is restated. Composing strings keeps the
 * utilities visible, lets a caller append `hover:` or `sm:` variants at the call site,
 * and leaves index.css holding only tokens and third-party overrides.
 *
 * Every class appears as a plain string literal so Tailwind's scanner can find it.
 */

/** Uppercase micro-label above a control — the instrument-panel tell. */
export const label = 'block mb-2 text-2xs uppercase tracking-label text-muted'

/** Text input, select, and anything else that takes typing. */
export const field =
  'w-full rounded-xs border border-line bg-panel px-3 py-2 text-text ' +
  'placeholder:text-muted/60 focus:border-accent focus:outline-none'

/** Shared between <button> and <a>, so both read identically. */
const buttonBase =
  'inline-flex items-center gap-2 rounded-xs border px-4 py-2 ' +
  'text-sm uppercase tracking-ui no-underline transition-colors duration-150 ' +
  'disabled:cursor-not-allowed disabled:opacity-40'

export const button =
  buttonBase +
  ' border-line-bright bg-raised text-text hover:border-accent hover:text-accent' +
  ' disabled:hover:border-line-bright disabled:hover:text-text'

export const buttonPrimary =
  buttonBase + ' border-accent/60 text-accent hover:bg-accent hover:text-ink'

/** Bordered surface used for grouped content. */
export const panel = 'rounded-xs border border-line bg-panel/70'
