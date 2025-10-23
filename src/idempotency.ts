const seen = new Map<string, number>();
const TTL = 3 * 60 * 1000;

export function alreadyHandled(id: string): boolean {
  const now = Date.now();
  for (const [key, value] of seen) {
    if (now - value > TTL) {
      seen.delete(key);
    }
  }
  if (seen.has(id)) {
    return true;
  }
  seen.set(id, now);
  return false;
}
