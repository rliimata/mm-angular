import { environment } from '../../environments/environment';

export function movieImageUrl(id: number | null | undefined): string {
  if (id == null || id <= 0) {
    return '';
  }
  return `${environment.mediaBaseUrl}/movies/${id}.jpg`;
}

export function personImageUrl(id: number | null | undefined): string {
  if (id == null || id <= 0) {
    return '';
  }
  return `${environment.mediaBaseUrl}/persons/${id}.jpg`;
}
