import { useCallback, useEffect, useRef, useState } from 'react'
import MDEditor from '@uiw/react-md-editor'
import { PassphraseInput } from '@/components/PassphraseInput'
import { getPaste, type Paste } from '@/lib/api'
import { DecryptFailedError, decryptText } from '@/lib/crypto'
import { saveDraft } from '@/lib/draft'
import { MARKDOWN_PLUGINS } from '@/lib/markdown'
import { button, buttonPrimary, label, panel } from '@/styles/ui'

function Notice({
  title,
  tone = 'muted',
  children,
}: {
  title: string
  tone?: 'muted' | 'danger'
  children: React.ReactNode
}) {
  const accent = tone === 'danger' ? 'text-danger' : 'text-muted'
  const rule = tone === 'danger' ? 'border-danger' : 'border-line'

  return (
    <section className="animate-reveal">
      <h1 className={`mb-4 text-xs uppercase tracking-label ${accent}`}>{title}</h1>
      <div className={`max-w-2xl border-l-2 pl-4 leading-relaxed ${rule}`}>{children}</div>
      <p className="mt-6">
        <a className={button} href="/">
          Create a paste
        </a>
      </p>
    </section>
  )
}

/**
 * Reading a paste can destroy it — the server deletes a burn-after-reading paste as it
 * serves it — so three rules hold this component together. Each is load-bearing:
 *
 *  1. Fetch at most once, ever. Guarded by a ref rather than the effect's dependencies,
 *     because StrictMode deliberately runs effects twice in development and the second
 *     run would spend the paste's only read before anyone saw the first.
 *  2. Do not fetch at all without a key. Without one the paste cannot be decrypted, so
 *     requesting it would burn it to show an error either way.
 *  3. Keep decryption out of the fetch. A wrong passphrase must cost nothing — retrying
 *     re-runs the cipher over the payload already in hand and never touches the network.
 */
export function ViewPaste({ id }: { id: string }) {
  // The key lives after the '#', which is why the server never saw it. Read once on
  // mount rather than tracked — nothing here changes the URL.
  const [key] = useState(() => window.location.hash.slice(1))

  const hasFetched = useRef(false)

  const [paste, setPaste] = useState<Paste | null>(null)
  const [loading, setLoading] = useState(key.length > 0)
  const [loadError, setLoadError] = useState('')

  const [text, setText] = useState<string | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [needsPassphrase, setNeedsPassphrase] = useState(false)
  const [decryptError, setDecryptError] = useState('')
  const [copied, setCopied] = useState(false)

  const attempt = useCallback(
    async (payload: string, candidate: string) => {
      try {
        setText(await decryptText(payload, key, candidate))
        setNeedsPassphrase(false)
        setDecryptError('')
      } catch (err) {
        if (err instanceof DecryptFailedError) {
          // Wrong key, wrong passphrase and a tampered payload are indistinguishable, so
          // assume the recoverable one and ask. Staying quiet on the first automatic
          // attempt keeps a passphrase-protected paste from opening with an error.
          setNeedsPassphrase(true)
          setDecryptError(candidate ? 'That did not work — wrong passphrase, or a broken link.' : '')
          return
        }

        setDecryptError(err instanceof Error ? err.message : String(err))
      }
    },
    [key],
  )

  useEffect(() => {
    if (!key || hasFetched.current) {
      return
    }
    hasFetched.current = true

    void (async () => {
      try {
        const fetched = await getPaste(id)
        setPaste(fetched)
        await attempt(fetched.payload, '')
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    })()
  }, [id, key, attempt])

  if (!key) {
    return (
      <Notice title="Incomplete link">
        <p>
          This link has nothing after the <span className="text-accent">#</span>. That part
          is the key, and it is the half that never reaches the server — so without it the
          paste cannot be opened, and cannot be recovered from anywhere. Ask whoever sent
          it for the whole link.
        </p>
      </Notice>
    )
  }

  if (loading) {
    return <p className="text-xs uppercase tracking-label text-muted">Fetching…</p>
  }

  if (loadError) {
    return (
      <Notice title="Not available" tone="danger">
        <p role="alert">{loadError}</p>
        <p className="mt-3 text-muted">
          Expired, already read, or never existed — the server does not say which, on
          purpose.
        </p>
      </Notice>
    )
  }

  if (!paste) {
    return null
  }

  if (needsPassphrase) {
    return (
      <form
        className="animate-reveal max-w-md"
        onSubmit={(event) => {
          event.preventDefault()
          void attempt(paste.payload, passphrase)
        }}
      >
        <h1 className="mb-4 text-xs uppercase tracking-label text-muted">Passphrase required</h1>
        <p className="mb-6 leading-relaxed text-muted">
          This paste was locked with a passphrase as well as the link. It is checked in
          your browser — nothing is sent.
        </p>

        <label className={label} htmlFor="unlock">
          Passphrase
        </label>
        <div className="flex gap-3">
          <div className="flex-1">
            <PassphraseInput
              id="unlock"
              autoFocus
              autoComplete="current-password"
              value={passphrase}
              onChange={setPassphrase}
            />
          </div>
          <button type="submit" className={buttonPrimary}>
            Unlock
          </button>
        </div>

        {decryptError && (
          <p role="alert" className="mt-4 text-sm text-danger">
            {decryptError}
          </p>
        )}

        <p className="mt-8 border-t border-line pt-6">
          <a className={button} href="/">
            Create a paste
          </a>
        </p>
      </form>
    )
  }

  if (decryptError) {
    return (
      <Notice title="Could not read this paste" tone="danger">
        <p role="alert">{decryptError}</p>
      </Notice>
    )
  }

  if (text === null) {
    return <p className="text-xs uppercase tracking-label text-muted">Decrypting…</p>
  }

  const reuseAsNewPaste = () => {
    saveDraft(text)
    window.location.assign('/')
  }

  const copyMarkdown = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <article className="animate-reveal">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xs uppercase tracking-label text-muted">Paste</h1>
        <p className="text-xs text-muted">
          Created {new Date(paste.createdAt).toLocaleString()}
          {' · '}
          {paste.expiresAt === null ? 'Never expires' : `Expires ${new Date(paste.expiresAt).toLocaleString()}`}
        </p>
      </div>

      {/* Ahead of the controls, not after them: this is the one irreversible fact on the
          screen, and it is what makes "Reuse this content" worth reaching for. A reader
          who meets the buttons first has already been asked to choose before being told
          the paste is gone. */}
      {paste.burnAfterReading && (
        <p
          role="alert"
          className="mb-6 max-w-2xl border-l-2 border-danger pl-4 text-sm leading-relaxed text-danger"
        >
          <strong className="uppercase tracking-ui">This paste is now deleted.</strong> It was
          set to burn after reading, so the server dropped it while serving this request.
          Reloading will not bring it back — copy anything you need now.
        </p>
      )}

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <button className={buttonPrimary} onClick={() => void copyMarkdown()}>
          {copied ? 'Copied' : 'Copy markdown'}
        </button>
        <a className={button} href="/">
          Create blank paste
        </a>
        <button className={button} onClick={reuseAsNewPaste}>
          Reuse as new paste
        </button>
      </div>

      <div className={`${panel} p-6 sm:p-8`} data-color-mode="dark">
        <MDEditor.Markdown source={text} rehypePlugins={MARKDOWN_PLUGINS} />
      </div>

    </article>
  )
}
