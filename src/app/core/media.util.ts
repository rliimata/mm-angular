import { environment } from '../../environments/environment';

type MediaKind = 'movies' | 'persons';

function bustKey(kind: MediaKind, id: number): string {
  return `mm-img-bust:${kind}:${id}`;
}

/** Last upload time for this image (survives F5 in the same browser). */
export function getMediaCacheBust(kind: MediaKind, id: number): number {
  try {
    const raw = localStorage.getItem(bustKey(kind, id));
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function setMediaCacheBust(kind: MediaKind, id: number, t = Date.now()): number {
  try {
    localStorage.setItem(bustKey(kind, id), String(t));
  } catch {
    /* private mode / blocked storage */
  }
  return t;
}

function withBust(url: string, kind: MediaKind, id: number, bust?: number): string {
  const t = bust ?? getMediaCacheBust(kind, id);
  return t ? `${url}?t=${t}` : url;
}

export function movieImageUrl(id: number | null | undefined, bust?: number): string {
  if (id == null || id <= 0) {
    return '';
  }
  return withBust(`${environment.mediaBaseUrl}/movies/${id}.jpg`, 'movies', id, bust);
}

export function personImageUrl(id: number | null | undefined, bust?: number): string {
  if (id == null || id <= 0) {
    return '';
  }
  return withBust(`${environment.mediaBaseUrl}/persons/${id}.jpg`, 'persons', id, bust);
}
