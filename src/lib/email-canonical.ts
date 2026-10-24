/**
 * Canonical mailbox for duplicate detection. Gmail ignores dots and anything after "+", and
 * googlemail.com is the same mailbox, so "j.doe+x@gmail.com" and "jdoe@gmail.com" are one person.
 */
export function canonicalEmail(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 0) return e;
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.split("+")[0].replace(/\./g, "");
  return `${local}@${domain}`;
}
