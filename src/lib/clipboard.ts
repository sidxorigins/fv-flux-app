/**
 * Write `value` to the clipboard, reporting success rather than throwing.
 *
 * `navigator.clipboard` is undefined outside a secure context (plain http on a
 * LAN address, for instance) and can be denied by permissions policy, so every
 * caller has to handle failure — returning a boolean keeps that handling to an
 * `if` instead of a try/catch at each call site.
 *
 * Browser-only: call it from an event handler in a client component.
 */
export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
