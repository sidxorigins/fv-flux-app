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

/**
 * Attachment ids referenced by inline images (`/api/files/<id>`) in comment HTML.
 * Client-safe (pure regex, no sanitiser import) so the composer can tell which
 * uploaded images are still present in the body. Mirrors the server-side
 * `extractInlineImageIds` in lib/sanitize.
 */
export function extractInlineImageIds(html: string): string[] {
  const ids = new Set<string>();
  const re = /\/api\/files\/([A-Za-z0-9]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) ids.add(match[1]!);
  return [...ids];
}

/**
 * Does the comment carry anything worth posting — visible text, an inline image,
 * or (when `attachmentCount > 0`) a file attachment?
 */
export function hasCommentContent(html: string, attachmentCount: number): boolean {
  if (attachmentCount > 0) return true;
  if (!isRichTextEmpty(html)) return true;
  return extractInlineImageIds(html).length > 0;
}
