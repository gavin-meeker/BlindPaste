import { useCallback, useEffect, useRef, useState } from 'react'
import MDEditor from '@uiw/react-md-editor'
import { PassphraseInput } from '@/components/PassphraseInput'
import { getPaste, type Paste } from '@/lib/api'
import { DecryptFailedError, decryptText } from '@/lib/crypto'
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

        {/* Without this the screen is a dead end: someone who does not have the
            passphrase has no way out but the back button. Every other state here
            offers the same exit. It is an <a>, not a <button>, so it navigates
            instead of submitting the form around it. */}
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

  return (
    <article className="animate-reveal">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xs uppercase tracking-label text-muted">Paste</h1>
        <p className="text-xs text-muted">
          Expires {new Date(paste.expiresAt).toLocaleString()}
        </p>
      </div>

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

      {/* The panel spans the wide shell so tables and code blocks have room, but the
          prose inside is capped at a readable measure — line length is what makes body
          text comfortable, and 1100px of it would not be. */}
      <div className={`${panel} p-6 sm:p-8`} data-color-mode="dark">
        <div className="max-w-[78ch]">
          <MDEditor.Markdown source={text} rehypePlugins={MARKDOWN_PLUGINS} />
        </div>
      </div>

      <p className="mt-6">
        <a className={button} href="/">
          Create a paste
        </a>
      </p>
    </article>
  )
}
