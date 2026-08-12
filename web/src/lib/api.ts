// Talks to the API. Requests go to /api/*, which the dev server proxies to the
// backend (see vite.config.ts), so there is no base URL to configure and no CORS.
//
// Nothing here touches the key. Only the payload — already encrypted by crypto.ts —
// is ever sent; the key stays in the URL fragment, which browsers do not transmit.

/** The paste is gone: never existed, expired, or was burned by an earlier read. */
export class PasteUnavailableError extends Error {
  constructor() {
    super('This paste is not available. It may have expired, already been read, or never existed.')
    this.name = 'PasteUnavailableError'
  }
}

/** Any other non-2xx. `message` is the server's, when it gave a usable one. */
export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export type CreatePasteResult = {
  id: string
  createdAt: string
  /** Null means the paste never expires. */
  expiresAt: string | null
  burnAfterReading: boolean
}

export type Paste = {
  payload: string
  createdAt: string
  /** Null means the paste never expires. */
  expiresAt: string | null
  burnAfterReading: boolean
}

type ProblemDetails = {
  title?: string
  errors?: Record<string, string[]>
}

/**
 * Turns a failed response into the most specific error available.
 *
 * A 404 is deliberately one case, not three — the server will not say whether a paste
 * expired, was burned, or never existed, so neither does this.
 */
async function toError(response: Response): Promise<Error> {
  if (response.status === 404) {
    return new PasteUnavailableError()
  }

  if (response.status === 429) {
    return new ApiError('Too many pastes created just now. Wait a moment and try again.', 429)
  }

  let problem: ProblemDetails | null = null
  try {
    problem = (await response.json()) as ProblemDetails
  } catch {
    // Not every failure is ProblemDetails — a proxy error page, say. Fall through.
  }

  // Validation failures put the useful sentence in errors[field][0]; the top-level
  // title is only ever "One or more validation errors occurred."
  const fieldError = problem?.errors && Object.values(problem.errors).flat()[0]

  return new ApiError(fieldError ?? problem?.title ?? `Request failed (${response.status}).`, response.status)
}

export async function createPaste(request: {
  payload: string
  /** Omit, alongside `neverExpires: true`, to request no expiry at all. */
  expiresInSeconds?: number
  burnAfterReading: boolean
  neverExpires?: boolean
}): Promise<CreatePasteResult> {
  const response = await fetch('/api/pastes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    throw await toError(response)
  }

  return (await response.json()) as CreatePasteResult
}

/**
 * Reads a paste. For a burn-after-reading paste this is destructive — the server
 * deletes the row as it serves it, so calling this twice gets the content once.
 */
export async function getPaste(id: string): Promise<Paste> {
  const response = await fetch(`/api/pastes/${encodeURIComponent(id)}`)

  if (!response.ok) {
    throw await toError(response)
  }

  return (await response.json()) as Paste
}
