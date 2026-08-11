import rehypeSanitize from 'rehype-sanitize'

/**
 * The rehype plugins every markdown render must use. One definition, imported by both
 * the editor's preview and the paste viewer, so the two cannot drift apart.
 *
 * Do not render markdown without this. Markdown allows raw HTML by design, so anything
 * that renders a paste renders whatever HTML it contains — and a paste is written by
 * whoever sent you the link, then executed on *this* origin. Without sanitizing,
 * `<img src=x onerror=...>` in a paste runs with full same-origin access: it can call
 * the API as the reader, read storage, and draw a convincing fake prompt on a domain
 * the reader already trusts.
 *
 * It does not protect the ciphertext — the paste's author already knows its key. What
 * it protects is the reader's browser.
 */
export const MARKDOWN_PLUGINS = [rehypeSanitize]
