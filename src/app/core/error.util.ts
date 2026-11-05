/** Readable message from Error, Postgrest-style `{ message }`, or unknown. */
export function errorMessage(e: unknown): string {
  if (e == null) {
    return '';
  }
  if (typeof e === 'string') {
    return e;
  }
  if (e instanceof Error && e.message) {
    return e.message;
  }
  if (typeof e === 'object') {
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.trim()) {
      return msg;
    }
    const details = (e as { details?: unknown }).details;
    if (typeof details === 'string' && details.trim()) {
      return details;
    }
    try {
      return JSON.stringify(e);
    } catch {
      return 'Tuntematon virhe';
    }
  }
  return String(e);
}
