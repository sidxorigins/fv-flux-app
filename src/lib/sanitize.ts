// Server-side rich-text sanitisation. Tiptap content (task descriptions, comments)
// is persisted as HTML — it MUST be sanitised on the server before it is stored or
// rendered, or it becomes a stored-XSS vector. Never `dangerouslySetInnerHTML`
// anything that hasn't been through `sanitizeRichText`.
//
// The allowlist matches Tiptap StarterKit output. Everything not listed is dropped.

import sanitizeHtml from "sanitize-html";

/**
 * Inline comment images are stored as `<img src="/api/files/<attachmentId>">`,
 * where the route authorises every request and 302s to a presigned GET (the
 * bucket stays private). ONLY this exact relative shape is allowed — no external
 * URLs, no `data:`, no `javascript:`. Any other `src` drops the whole <img>
 * (see `exclusiveFilter`), which also kills tracking pixels and SSRF vectors.
 */
export const INLINE_IMAGE_SRC = /^\/api\/files\/[A-Za-z0-9]+$/;

const RICH_TEXT_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "h1",
    "h2",
    "h3",
    "strong",
    "em",
    "s",
    "u",
    "code",
    "pre",
    "blockquote",
    "ul",
    "ol",
    "li",
    "br",
    "hr",
    "a",
    // Inline images — only our own /api/files/<id> serve route (enforced below).
    "img",
    // @-mention chips: Tiptap's Mention node renders `<span class="mention"
    // data-type="mention" data-id="username">@username</span>`. Kept so mentions
    // render highlighted; even if stripped, the inner `@username` text survives
    // and the server-side mention parser still fires.
    "span",
  ],
  // <a> keeps href/target/rel (forced safe below); <img> keeps only src/alt (src
  // shape-checked in exclusiveFilter); the mention <span> keeps only its
  // data-type/data-id markers. No other attributes anywhere — onerror/srcset/
  // style/class on <img> are all dropped.
  allowedAttributes: {
    a: ["href", "target", "rel"],
    img: ["src", "alt"],
    span: ["data-type", "data-id"],
  },
  // Class is disallowed everywhere EXCEPT code/pre (the `language-xxx` hint) and
  // the mention span (exactly `mention`). allowedClasses implicitly permits the
  // class attribute for these tags and filters the values.
  allowedClasses: {
    code: [/^language-[\w-]+$/],
    pre: [/^language-[\w-]+$/],
    span: ["mention"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { a: ["http", "https", "mailto"] },
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  // Drop any <img> whose src isn't our own /api/files/<id> serve path. Relative
  // URLs bypass allowedSchemes, so this is where external/`data:` srcs are killed.
  exclusiveFilter: (frame) =>
    frame.tag === "img" && !INLINE_IMAGE_SRC.test(frame.attribs.src ?? ""),
  // No inline styles — not in allowedAttributes, so dropped.
  transformTags: {
    a: (_tagName, attribs) => ({
      tagName: "a",
      attribs: {
        ...(attribs.href ? { href: attribs.href } : {}),
        rel: "noopener noreferrer nofollow",
        target: "_blank",
      },
    }),
  },
};

/** Sanitise Tiptap/rich-text HTML to the strict allowlist above. */
export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, RICH_TEXT_OPTIONS);
}

/**
 * Sanitise a comment body, additionally dropping any inline `<img>` whose
 * attachment id is NOT in `allowedImageIds` — so a comment can only embed images
 * that were actually uploaded to it and validated server-side (not an arbitrary
 * `/api/files/<id>` a crafted request supplies). Non-image content is treated
 * exactly like `sanitizeRichText`.
 */
export function sanitizeCommentBody(
  html: string,
  allowedImageIds: Iterable<string>,
): string {
  const allowed = new Set(allowedImageIds);
  return sanitizeHtml(html, {
    ...RICH_TEXT_OPTIONS,
    exclusiveFilter: (frame) => {
      if (frame.tag !== "img") return false;
      const src = frame.attribs.src ?? "";
      if (!INLINE_IMAGE_SRC.test(src)) return true; // not our route → drop
      const id = src.slice("/api/files/".length);
      return !allowed.has(id); // valid shape but not linked → drop
    },
  });
}

/** Attachment ids referenced by `/api/files/<id>` inside sanitised HTML. */
export function extractInlineImageIds(html: string): string[] {
  const ids = new Set<string>();
  const re = /\/api\/files\/([A-Za-z0-9]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) ids.add(match[1]!);
  return [...ids];
}

// C0 (0x00-0x1F) + DEL (0x7F) + C1 (0x80-0x9F) control characters.
const CONTROL_CHARS = /[\x00-\x1f\x7f-\x9f]/g;

/**
 * Normalise a short plain-text value (filename for display, label name, etc.):
 * strip control characters, collapse surrounding whitespace, and cap the length.
 * This is display/label hygiene — it is NOT used to build storage keys or paths
 * (see `lib/r2.ts` for object-key construction).
 */
export function sanitizePlainText(str: string, maxLength = 255): string {
  return str.replace(CONTROL_CHARS, "").trim().slice(0, maxLength);
}
