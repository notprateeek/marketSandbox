/**
 * Pure profile-handle rules. A handle is lowercase, 3–20 chars of a–z, 0–9 and
 * underscore. Normalises a raw input (strips a leading @ and surrounding space,
 * lowercases) and returns null when it can't be a valid handle.
 */
export function normalizeHandle(raw: string): string | null {
  const handle = raw.trim().replace(/^@/, '').toLowerCase();
  return /^[a-z0-9_]{3,20}$/.test(handle) ? handle : null;
}
