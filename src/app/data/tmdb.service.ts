import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { getSupabase } from '../core/supabase.client';

export interface TmdbSearchResult {
  id: number;
  title: string;
  originalTitle: string;
  year: number | null;
  overview: string;
  posterUrl: string | null;
}

export interface TmdbProvider {
  id: number;
  name: string;
  logoUrl: string | null;
  priority: number;
}

export interface TmdbWatchProviders {
  region: string;
  link: string | null;
  flatrate: TmdbProvider[];
  rent: TmdbProvider[];
  buy: TmdbProvider[];
  free: TmdbProvider[];
}

export interface TmdbCreditPerson {
  name: string;
  gender: number | null;
}

export interface TmdbMovieDetails {
  id: number;
  title: string;
  originalTitle: string;
  originalLanguage: string;
  overview: string;
  runtime: number | null;
  budget: number | null;
  releaseDate: string | null;
  year: number | null;
  genres: { id: number; name: string }[];
  countries: { iso: string; name: string }[];
  alternativeTitles: { iso: string; title: string }[];
  certificationFi: string | null;
  credits: {
    directors: TmdbCreditPerson[];
    writers: TmdbCreditPerson[];
    composers: TmdbCreditPerson[];
    cast: TmdbCreditPerson[];
  };
}

@Injectable({ providedIn: 'root' })
export class TmdbService {
  private async authHeaders(): Promise<HeadersInit> {
    const {
      data: { session },
    } = await getSupabase().auth.getSession();
    if (!session?.access_token) {
      throw new Error('Kirjautuminen vaaditaan.');
    }
    return { Authorization: `Bearer ${session.access_token}` };
  }

  private async getJson<T>(params: Record<string, string>): Promise<T> {
    const qs = new URLSearchParams(params).toString();
    const base = environment.tmdbApiUrl;
    const href = base.includes('?') ? `${base}&${qs}` : `${base}?${qs}`;

    const res = await fetch(href, { headers: await this.authHeaders() });
    const text = await res.text();
    let json: T & { error?: string; debug?: { keyLen?: number; keyKind?: string; keyTail?: string } } =
      {} as T & { error?: string; debug?: { keyLen?: number; keyKind?: string; keyTail?: string } };
    try {
      json = JSON.parse(text) as typeof json;
    } catch {
      /* plain */
    }
    if (!res.ok) {
      const dbg = json.debug
        ? ` [key ${json.debug.keyKind || '?'} len=${json.debug.keyLen ?? '?'} …${json.debug.keyTail || ''}]`
        : '';
      throw new Error((json.error || text || `TMDB-pyyntö epäonnistui (${res.status})`) + dbg);
    }
    return json;
  }

  searchMovies(query: string, year?: number | null): Promise<{ results: TmdbSearchResult[] }> {
    const params: Record<string, string> = { action: 'search', q: query.trim() };
    if (year != null && Number.isFinite(year) && year > 0) {
      params['year'] = String(year);
    }
    return this.getJson(params);
  }

  watchProviders(tmdbId: number, region = 'FI'): Promise<TmdbWatchProviders> {
    return this.getJson({
      action: 'providers',
      tmdbId: String(tmdbId),
      region,
    });
  }

  movieDetails(tmdbId: number): Promise<TmdbMovieDetails> {
    return this.getJson({
      action: 'details',
      tmdbId: String(tmdbId),
    });
  }
}
