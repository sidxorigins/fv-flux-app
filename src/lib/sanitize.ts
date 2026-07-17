// Server-side rich-text sanitisation. Tiptap content (task descriptions, comments)
// is persisted as HTML — it MUST be sanitised on the server before it is stored or
// rendered, or it becomes a stored-XSS vector. Never `dangerouslySetInnerHTML`
// anything that hasn't been through `sanitizeRichText`.
//
// The allowlist matches Tiptap StarterKit output. Everything not listed is dropped.

import sanitizeHtml from "sanitize-html";

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
    // @-mention chips: Tiptap's Mention node renders `<span class="mention"
    // data-type="mention" data-id="username">@username</span>`. Kept so mentions
    // render highlighted; even if stripped, the inner `@username` text survives
    // and the server-side mention parser still fires.
    "span",
  ],
  // <a> keeps href/target/rel (forced safe below); the mention <span> keeps only
  // its data-type/data-id markers. No other attributes anywhere.
  allowedAttributes: {
    a: ["href", "target", "rel"],
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
  // No <img>, no inline styles — not in allowedTags/allowedAttributes, so dropped.
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
