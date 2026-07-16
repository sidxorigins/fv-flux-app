import { describe, expect, it } from "vitest";
import { sanitizePlainText, sanitizeRichText } from "./sanitize";

describe("sanitizeRichText", () => {
  it("strips <script> tags entirely, including their content", () => {
    expect(sanitizeRichText("<p>Hello <script>alert(1)</script>world</p>")).toBe(
      "<p>Hello world</p>",
    );
  });

  it("strips <img> tags (including onerror handlers) — no img in the allowlist", () => {
    expect(sanitizeRichText('<img src="x" onerror="alert(1)">')).toBe("");
  });

  it("strips inline style and class attributes on ordinary tags", () => {
    expect(sanitizeRichText('<p style="color:red" class="foo">Styled</p>')).toBe(
      "<p>Styled</p>",
    );
  });

  it("keeps a language-* class only on code/pre", () => {
    const html = '<pre><code class="language-js">const x=1;</code></pre>';
    expect(sanitizeRichText(html)).toBe(html);
  });

  it("drops a class on code/pre that doesn't match the language- pattern", () => {
    expect(sanitizeRichText('<code class="evil">x</code>')).toBe("<code>x</code>");
  });

  it("strips javascript: hrefs but keeps the anchor (and forces rel/target)", () => {
    expect(sanitizeRichText('<a href="javascript:alert(1)">bad</a>')).toBe(
      '<a rel="noopener noreferrer nofollow" target="_blank">bad</a>',
    );
  });

  it("strips data: hrefs but keeps the anchor (and forces rel/target)", () => {
    expect(sanitizeRichText('<a href="data:text/html,evil">bad</a>')).toBe(
      '<a rel="noopener noreferrer nofollow" target="_blank">bad</a>',
    );
  });

  it("keeps https hrefs and forces rel=noopener noreferrer nofollow + target=_blank", () => {
    expect(sanitizeRichText('<a href="https://example.com">good</a>')).toBe(
      '<a href="https://example.com" rel="noopener noreferrer nofollow" target="_blank">good</a>',
    );
  });

  it("keeps http hrefs", () => {
    expect(sanitizeRichText('<a href="http://example.com">good</a>')).toBe(
      '<a href="http://example.com" rel="noopener noreferrer nofollow" target="_blank">good</a>',
    );
  });

  it("keeps mailto hrefs", () => {
    expect(sanitizeRichText('<a href="mailto:test@example.com">mail</a>')).toBe(
      '<a href="mailto:test@example.com" rel="noopener noreferrer nofollow" target="_blank">mail</a>',
    );
  });

  it("overrides an attacker-supplied target/rel rather than merging with it", () => {
    const html = '<a href="http://example.com" target="_self" rel="foo">explicit</a>';
    expect(sanitizeRichText(html)).toBe(
      '<a href="http://example.com" rel="noopener noreferrer nofollow" target="_blank">explicit</a>',
    );
  });

  it("keeps every allowlisted tag", () => {
    const html =
      "<p>p</p><h1>h1</h1><h2>h2</h2><h3>h3</h3><strong>strong</strong>" +
      "<em>em</em><blockquote>quote</blockquote><ul><li>item</li></ul>" +
      "<ol><li>item</li></ol><code>code</code><pre>pre</pre>";
    expect(sanitizeRichText(html)).toBe(html);
  });

  it("discards a disallowed tag but keeps its text content", () => {
    expect(sanitizeRichText("<div>unknown tag</div>")).toBe("unknown tag");
  });

  it("drops an anchor with no href but still forces rel/target", () => {
    expect(sanitizeRichText("<a>no href</a>")).toBe(
      '<a rel="noopener noreferrer nofollow" target="_blank">no href</a>',
    );
  });
});

describe("sanitizePlainText", () => {
  it("strips C0 control characters", () => {
    expect(sanitizePlainText("a\x00b\x1fc")).toBe("abc");
  });

  it("strips DEL and C1 control characters", () => {
    expect(sanitizePlainText("a\x7fb\x9fc")).toBe("abc");
  });

  it("trims surrounding whitespace after stripping control chars", () => {
    expect(sanitizePlainText(" \x00 hello \x00 ")).toBe("hello");
  });

  it("caps at the default length of 255", () => {
    const input = "a".repeat(300);
    const result = sanitizePlainText(input);
    expect(result).toHaveLength(255);
    expect(result).toBe("a".repeat(255));
  });

  it("caps at a custom maxLength", () => {
    expect(sanitizePlainText("abcdefgh", 4)).toBe("abcd");
  });

  it("leaves a clean, short string untouched", () => {
    expect(sanitizePlainText("hello world")).toBe("hello world");
  });
});
