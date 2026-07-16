// Plain-text extraction for the "is this comment blank?" check. Shared by the
// client composer (to disable the submit button) and the server action (to
// reject a comment that is whitespace-only AFTER sanitisation).
//
// NOT a security boundary: real XSS sanitisation lives in lib/sanitize
// (`sanitizeRichText`). This only strips tags/entities so we can tell whether
// anything meaningful was typed — an empty Tiptap doc serialises to `<p></p>`.

export function richTextToPlainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ") // drop tags
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the rich text has no visible content (empty, whitespace, bare tags). */
export function isRichTextEmpty(html: string): boolean {
  return richTextToPlainText(html).length === 0;
}
