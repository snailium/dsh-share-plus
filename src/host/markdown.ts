/**
 * Markdown rendering for share-page message text.
 *
 * Uses markdown-it with its SAFE defaults: `html: false` escapes any raw HTML
 * in the source (so a message can never inject a `<script>` or other markup),
 * and the built-in link validator rejects `javascript:` / `vbscript:` / `data:`
 * URLs. `linkify` auto-links bare URLs; `breaks` preserves single newlines so
 * multi-line chat text does not collapse into one run. Output is trusted
 * HTML — it replaces the previous plain-text escape and is injected verbatim.
 */

import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
})

/** Render untrusted text to safe HTML. */
export function renderMarkdown(text: string): string {
  return md.render(text)
}
