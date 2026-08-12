import { CreatePaste } from '@/components/CreatePaste'
import { GitHubLink } from '@/components/GitHubLink'
import { ViewPaste } from '@/components/ViewPaste'

// Two screens, so the path is read once rather than routed. There is no client-side
// navigation: creating a paste produces a link, and opening one is a fresh page load.
// Swap in a router when a third screen turns up.
//
// The id pattern matches what the API issues — 22 base64url characters — and is
// case-sensitive, which matters: these ids are 128 bits of randomness and `aB` is not
// `Ab`.
const PASTE_PATH = /^\/p\/([A-Za-z0-9_-]{22})$/

// The shell is wide for the editor's sake. Running text keeps its own, narrower cap
// wherever it appears, because line length is what makes prose readable.
const SHELL = 'mx-auto w-full max-w-6xl px-6'

function App() {
  const match = PASTE_PATH.exec(window.location.pathname)

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className={`${SHELL} flex items-center justify-between gap-4 py-5`}>
          <a href="/" className="flex items-baseline gap-2 no-underline">
            <span className="text-lg uppercase tracking-brand text-text">Blind</span>
            <span className="text-lg uppercase tracking-brand text-accent">Paste</span>
          </a>
          <div className="flex items-center gap-5">
            <p className="text-2xs uppercase tracking-label text-muted">
              Encrypted in your browser
            </p>
            <GitHubLink />
          </div>
        </div>
      </header>

      <main className={`${SHELL} flex-1 py-10`}>
        {match ? <ViewPaste id={match[1]} /> : <CreatePaste />}
      </main>

      <footer className="border-t border-line">
        <div className={`${SHELL} py-5`}>
          <p className="max-w-2xl text-xs leading-relaxed text-muted">
            The key lives after the <span className="text-accent">#</span> and is never sent
            to the server — but it is in your address bar, your history, and wherever you
            send the link. Treat the link as the secret.
          </p>
        </div>
      </footer>
    </div>
  )
}

export default App
