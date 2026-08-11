import { useState } from 'react'
import { field } from '@/styles/ui'

type PassphraseInputProps = {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoComplete?: string
  autoFocus?: boolean
}

/**
 * A passphrase field with a show/hide toggle.
 *
 * Shared by both screens on purpose: the passphrase typed when creating a paste and the
 * one typed when opening it have to match exactly, and a typo in either is
 * indistinguishable from a broken link — decryption cannot tell you which went wrong.
 * Being able to read back what you typed is the only defence against that.
 */
export function PassphraseInput({
  id,
  value,
  onChange,
  placeholder,
  autoComplete = 'off',
  autoFocus,
}: PassphraseInputProps) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="relative">
      <input
        id={id}
        // Swapping the type is what reveals it; the value is never touched.
        type={visible ? 'text' : 'password'}
        className={`${field} pr-16`}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />

      <button
        // Explicitly a button: the default type inside a <form> is "submit", which would
        // create the paste on the first click instead of revealing the passphrase.
        type="button"
        onClick={() => setVisible((shown) => !shown)}
        aria-pressed={visible}
        aria-controls={id}
        aria-label={visible ? 'Hide passphrase' : 'Show passphrase'}
        className="absolute inset-y-0 right-0 px-3 text-2xs uppercase tracking-ui
                   text-muted transition-colors hover:text-accent focus-visible:text-accent"
      >
        {visible ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}
