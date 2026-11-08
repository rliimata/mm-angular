import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { AuthService } from '../core/auth.service';
import { getSupabase } from '../core/supabase.client';

@Injectable({ providedIn: 'root' })
export class MediaService {
  constructor(private readonly auth: AuthService) {}

  async uploadImage(
    kind: 'movie' | 'person',
    entityId: number,
    file: File
  ): Promise<{ url: string; t: number }> {
    if (!this.auth.isSuperUser()) {
      throw new Error('Vain ylläpitäjä voi vaihtaa kuvia.');
    }
    if (!entityId || entityId <= 0) {
      throw new Error('Tallenna tietue ennen kuvan latausta.');
    }

    const {
      data: { session },
    } = await getSupabase().auth.getSession();
    if (!session?.access_token) {
      throw new Error('Kirjautuminen vaaditaan.');
    }

    const body = new FormData();
    body.set('kind', kind === 'movie' ? 'movies' : 'persons');
    body.set('id', String(entityId));
    body.set('file', file, file.name);

    const res = await fetch(environment.mediaUploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      body,
    });

    const text = await res.text();
    let json: { error?: string; url?: string; t?: number } = {};
    try {
      json = JSON.parse(text) as { error?: string; url?: string; t?: number };
    } catch {
      /* plain text */
    }
    if (!res.ok) {
      throw new Error(json.error || text || `Upload failed (${res.status})`);
    }
    return { url: json.url || '', t: json.t || Date.now() };
  }
}
