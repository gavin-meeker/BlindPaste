import { useState } from 'react'
import MDEditor from '@uiw/react-md-editor'
import { PassphraseInput } from '@/components/PassphraseInput'
import { createPaste } from '@/lib/api'
import { encryptText } from '@/lib/crypto'
import { MARKDOWN_PLUGINS } from '@/lib/markdown'
import { button, buttonPrimary, field, label, panel } from '@/styles/ui'

// Kept inside the API's configured range (min 1 minute, max 30 days).
const EXPIRY_OPTIONS = [
  { label: '1 hour', seconds: 3600 },
  { label: '1 day', seconds: 86_400 },
  { label: '7 days', seconds: 604_800 },
  { label: '30 days', seconds: 2_592_000 },
]

type Created = {
  link: string
  burnAfterReading: boolean
}

export function CreatePaste() {
  const [text, setText] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [expiresInSeconds, setExpiresInSeconds] = useState(EXPIRY_OPTIONS[1].seconds)
  const [burnAfterReading, setBurnAfterReading] = useState(false)

  const [created, setCreated] = useState<Created | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setBusy(true)

    try {
      // Encrypting inside the same try as the request means a Web Crypto failure — an
      // insecure context, say — surfaces the same way a rejected request does, and the
      // form has one error to render rather than two.
      const { key, payload } = await encryptText(text, passphrase)
      const paste = await createPaste({ payload, expiresInSeconds, burnAfterReading })

      // The key goes after the '#'. Browsers do not send the fragment to the server,
      // which is what keeps the server unable to read what it is storing. It is not in
      // the response — it is only ever known here.
      setCreated({
        link: `${window.location.origin}/p/${paste.id}#${key}`,
        burnAfterReading: paste.burnAfterReading,
      })
      setText('')
      setPassphrase('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function copy(link: string) {
    await navigator.clipboard.writeText(link)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  if (created) {
    // Split so the two halves of the link can be shown as what they are. The server
    // holds everything before the '#' and has never seen a byte after it; colouring
    // them differently makes that visible instead of merely documented.
    const [base, key] = created.link.split('#')

    return (
      <section className="animate-reveal">
        <h1 className="mb-6 text-xs uppercase tracking-label text-muted">Paste created</h1>

        <div className={`${panel} mb-4 p-4`}>
          <span className={label}>Link</span>
          <p className="break-all leading-relaxed">
            <span className="text-muted">{base}</span>
            <span className="text-accent">#{key}</span>
          </p>
        </div>

        <div className="mb-8 flex flex-wrap items-center gap-3">
          <button className={buttonPrimary} onClick={() => void copy(created.link)}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
          <a className={button} href={created.link}>
            Open it
          </a>
          <button className={button} onClick={() => setCreated(null)}>
            New paste
          </button>
        </div>

        <div className="max-w-2xl space-y-2 border-l-2 border-line pl-4">
          <p className="text-xs leading-relaxed text-muted">
            <span className="text-accent">The amber part is the key.</span> It was never sent
            to the server, and nothing can recover it — not us, not a database dump, not you.
            Lose it and the paste is gone.
          </p>
          {created.burnAfterReading && (
            <p className="text-xs leading-relaxed text-danger">
              Burn after reading is on. The first person to open this link is the only one
              who ever will.
            </p>
          )}
        </div>
      </section>
    )
  }

  return (
    <form onSubmit={submit} className="animate-reveal">
      <h1 className="mb-6 text-xs uppercase tracking-label text-muted">New paste</h1>

      <div className="mb-6">
        <span className={label}>Text — markdown</span>
        <div data-color-mode="dark">
          <MDEditor
            value={text}
            height={520}
            onChange={(value) => setText(value ?? '')}
            previewOptions={{ rehypePlugins: MARKDOWN_PLUGINS }}
          />
        </div>
      </div>

      <div className="mb-6 grid gap-6 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="passphrase">
            Passphrase — optional
          </label>
          <PassphraseInput
            id="passphrase"
            autoComplete="new-password"
            placeholder="second factor"
            value={passphrase}
            onChange={setPassphrase}
          />
          <p className="mt-2 text-xs text-muted">If set, the link alone will not open it.</p>
        </div>

        <div>
          <label className={label} htmlFor="expiry">
            Expires after
          </label>
          <select
            id="expiry"
            className={field}
            value={expiresInSeconds}
            onChange={(event) => setExpiresInSeconds(Number(event.target.value))}
          >
            {EXPIRY_OPTIONS.map((option) => (
              <option key={option.seconds} value={option.seconds} className="bg-panel">
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-muted">Deleted from the server after this.</p>
        </div>
      </div>

      <label className={`${panel} mb-8 flex cursor-pointer items-start gap-3 p-4`}>
        <input
          type="checkbox"
          className="mt-1 accent-accent"
          checked={burnAfterReading}
          onChange={(event) => setBurnAfterReading(event.target.checked)}
        />
        <span>
          <span className="block text-sm uppercase tracking-ui">Burn after reading</span>
          <span className="mt-1 block text-xs text-muted">
            Deleted the first time it is opened. One reader, ever.
          </span>
        </span>
      </label>

      <div className="flex items-center gap-4">
        {/* The editor is not a form control, so `required` no longer applies — the
            empty case has to be refused here instead. */}
        <button type="submit" className={buttonPrimary} disabled={busy || text.trim() === ''}>
          {busy ? 'Encrypting…' : 'Encrypt and create'}
        </button>
        <span className="text-xs text-muted">Encryption happens before anything is sent.</span>
      </div>

      {error && (
        <p role="alert" className="mt-6 max-w-2xl border-l-2 border-danger pl-4 text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  )
}
