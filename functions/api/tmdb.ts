interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  TMDB_API_KEY: string;
}

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w45';

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    Vary: 'Origin',
  };
}

function json(request: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(request),
    },
  });
}

async function requireUser(
  request: Request,
  env: Env
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return { ok: false, response: json(request, 401, { error: 'Kirjautuminen vaaditaan.' }) };
  }
  const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: auth,
      apikey: env.SUPABASE_ANON_KEY,
    },
  });
  if (!userRes.ok) {
    return { ok: false, response: json(request, 401, { error: 'Istunto ei kelpaa.' }) };
  }
  return { ok: true };
}

type TmdbSearchHit = {
  id: number;
  title: string;
  original_title?: string;
  release_date?: string;
  overview?: string;
  poster_path?: string | null;
};

type TmdbProvider = {
  provider_id: number;
  provider_name: string;
  logo_path: string | null;
  display_priority?: number;
};

function mapProvider(p: TmdbProvider) {
  return {
    id: p.provider_id,
    name: p.provider_name,
    logoUrl: p.logo_path ? `${TMDB_IMG}${p.logo_path}` : null,
    priority: p.display_priority ?? 999,
  };
}

function sortProviders(
  rows: ReturnType<typeof mapProvider>[]
): ReturnType<typeof mapProvider>[] {
  return [...rows].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name, 'fi'));
}

function cleanTmdbKey(raw: string): string {
  return raw
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\r|\n/g, '')
    .trim();
}

/** Supports TMDB v3 api_key or v4 Read Access Token (JWT). Tries both if needed. */
async function tmdbFetch(
  path: string,
  apiKey: string,
  query: Record<string, string> = {}
): Promise<Response> {
  const key = cleanTmdbKey(apiKey);
  const build = (mode: 'bearer' | 'api_key'): { url: string; headers: Record<string, string> } => {
    const url = new URL(`${TMDB_BASE}${path.startsWith('/') ? path : `/${path}`}`);
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (mode === 'bearer') {
      headers.Authorization = `Bearer ${key}`;
    } else {
      url.searchParams.set('api_key', key);
    }
    return { url: url.toString(), headers };
  };

  const preferBearer = key.startsWith('eyJ');
  const first = preferBearer ? 'bearer' : 'api_key';
  const second = preferBearer ? 'api_key' : 'bearer';

  const a = build(first);
  let res = await fetch(a.url, { headers: a.headers });
  if (res.ok) {
    return res;
  }

  // Retry alternate auth if TMDB rejects the key format.
  const errText = await res.text();
  const invalid =
    res.status === 401 ||
    /invalid api key/i.test(errText) ||
    /invalid.*token/i.test(errText) ||
    /not be authenticated/i.test(errText);
  if (!invalid || !key) {
    return new Response(errText, { status: res.status, headers: res.headers });
  }

  const b = build(second);
  return fetch(b.url, { headers: b.headers });
}

export const onRequestOptions: PagesFunction<Env> = async (context) =>
  new Response(null, { status: 204, headers: corsHeaders(context.request) });

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return json(request, 500, { error: 'Supabase-asetukset puuttuvat.' });
  }
  if (!env.TMDB_API_KEY) {
    return json(request, 500, { error: 'TMDB_API_KEY puuttuu.' });
  }

  const auth = await requireUser(request, env);
  if (!auth.ok) {
    return auth.response;
  }

  const url = new URL(request.url);
  const action = (url.searchParams.get('action') || '').trim();

  if (action === 'search') {
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 1) {
      return json(request, 400, { error: 'Hakusana puuttuu.' });
    }
    const year = (url.searchParams.get('year') || '').trim();
    const query: Record<string, string> = {
      query: q,
      include_adult: 'false',
      language: 'fi-FI',
    };
    if (/^\d{4}$/.test(year)) {
      query.year = year;
      query.primary_release_year = year;
    }

    const res = await tmdbFetch('/search/movie', env.TMDB_API_KEY, query);
    const text = await res.text();
    let body: { results?: TmdbSearchHit[]; status_message?: string } = {};
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      /* plain */
    }
    if (!res.ok) {
      const keyMeta = cleanTmdbKey(env.TMDB_API_KEY);
      return json(request, res.status >= 400 ? res.status : 500, {
        error: body.status_message || text || 'TMDB-haku epäonnistui.',
        debug: {
          keyLen: keyMeta.length,
          keyKind: keyMeta.startsWith('eyJ') ? 'jwt' : 'api_key',
          keyTail: keyMeta.slice(-4),
        },
      });
    }

    const results = (body.results ?? []).slice(0, 12).map((r) => ({
      id: r.id,
      title: r.title,
      originalTitle: r.original_title || r.title,
      year: r.release_date ? Number(r.release_date.slice(0, 4)) || null : null,
      overview: r.overview || '',
      posterUrl: r.poster_path ? `https://image.tmdb.org/t/p/w92${r.poster_path}` : null,
    }));
    return json(request, 200, { results });
  }

  if (action === 'providers') {
    const tmdbId = Number(url.searchParams.get('tmdbId') || '');
    const region = (url.searchParams.get('region') || 'FI').trim().toUpperCase() || 'FI';
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
      return json(request, 400, { error: 'Virheellinen tmdbId.' });
    }

    const res = await tmdbFetch(`/movie/${tmdbId}/watch/providers`, env.TMDB_API_KEY);
    const text = await res.text();
    let body: {
      results?: Record<
        string,
        {
          link?: string;
          flatrate?: TmdbProvider[];
          rent?: TmdbProvider[];
          buy?: TmdbProvider[];
          ads?: TmdbProvider[];
          free?: TmdbProvider[];
        }
      >;
      status_message?: string;
    } = {};
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      /* plain */
    }
    if (!res.ok) {
      return json(request, res.status >= 400 ? res.status : 500, {
        error: body.status_message || text || 'TMDB-providerit epäonnistuivat.',
      });
    }

    const country = body.results?.[region] ?? null;
    if (!country) {
      return json(request, 200, {
        region,
        link: null,
        flatrate: [],
        rent: [],
        buy: [],
        free: [],
      });
    }

    return json(request, 200, {
      region,
      link: country.link || null,
      flatrate: sortProviders((country.flatrate ?? []).map(mapProvider)),
      rent: sortProviders((country.rent ?? []).map(mapProvider)),
      buy: sortProviders((country.buy ?? []).map(mapProvider)),
      free: sortProviders([...(country.free ?? []), ...(country.ads ?? [])].map(mapProvider)),
    });
  }

  if (action === 'details') {
    const tmdbId = Number(url.searchParams.get('tmdbId') || '');
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
      return json(request, 400, { error: 'Virheellinen tmdbId.' });
    }

    const res = await tmdbFetch(`/movie/${tmdbId}`, env.TMDB_API_KEY, {
      language: 'fi-FI',
      append_to_response: 'credits,alternative_titles,release_dates',
    });
    const text = await res.text();
    let body: TmdbMovieDetailsBody = {};
    try {
      body = JSON.parse(text) as TmdbMovieDetailsBody;
    } catch {
      /* plain */
    }
    if (!res.ok) {
      return json(request, res.status >= 400 ? res.status : 500, {
        error: body.status_message || text || 'TMDB-tiedot epäonnistuivat.',
      });
    }

    return json(request, 200, mapMovieDetails(body));
  }

  return json(request, 400, { error: 'Tuntematon action (search|providers|details).' });
};

type TmdbMovieDetailsBody = {
  id?: number;
  title?: string;
  original_title?: string;
  original_language?: string;
  overview?: string;
  runtime?: number | null;
  budget?: number | null;
  release_date?: string;
  genres?: { id: number; name: string }[];
  production_countries?: { iso_3166_1: string; name: string }[];
  credits?: {
    cast?: { name?: string; gender?: number; order?: number }[];
    crew?: { name?: string; gender?: number; job?: string; department?: string }[];
  };
  alternative_titles?: { titles?: { iso_3166_1?: string; title?: string }[] };
  release_dates?: {
    results?: { iso_3166_1?: string; release_dates?: { certification?: string; type?: number }[] }[];
  };
  status_message?: string;
};

function uniqueNames(rows: { name: string; gender: number | null }[]): { name: string; gender: number | null }[] {
  const seen = new Set<string>();
  const out: { name: string; gender: number | null }[] = [];
  for (const row of rows) {
    const key = row.name.toLocaleLowerCase('fi');
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(row);
  }
  return out;
}

function mapGender(g: number | null | undefined): number | null {
  // TMDB: 1 female, 2 male → app: 1 Nainen, 0 Mies
  if (g === 1) {
    return 1;
  }
  if (g === 2) {
    return 0;
  }
  return null;
}

function mapMovieDetails(body: TmdbMovieDetailsBody) {
  const crew = body.credits?.crew ?? [];
  const cast = [...(body.credits?.cast ?? [])].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

  const directors = uniqueNames(
    crew
      .filter((c) => c.job === 'Director' && c.name)
      .map((c) => ({ name: String(c.name).trim(), gender: mapGender(c.gender) }))
  );
  const writers = uniqueNames(
    crew
      .filter((c) => c.name && ['Screenplay', 'Writer', 'Story'].includes(c.job || ''))
      .map((c) => ({ name: String(c.name).trim(), gender: mapGender(c.gender) }))
  );
  const composers = uniqueNames(
    crew
      .filter(
        (c) =>
          c.name &&
          (c.job === 'Original Music Composer' || c.job === 'Music' || c.job === 'Composer')
      )
      .map((c) => ({ name: String(c.name).trim(), gender: mapGender(c.gender) }))
  );
  const actors = uniqueNames(
    cast
      .filter((c) => c.name)
      .slice(0, 15)
      .map((c) => ({ name: String(c.name).trim(), gender: mapGender(c.gender) }))
  );

  const fiReleases =
    body.release_dates?.results?.find((r) => r.iso_3166_1 === 'FI')?.release_dates ?? [];
  const certificationFi =
    fiReleases.map((r) => (r.certification || '').trim()).find((c) => !!c) || null;

  const alt = (body.alternative_titles?.titles ?? [])
    .filter((t) => t.title && t.iso_3166_1)
    .map((t) => ({ iso: String(t.iso_3166_1).toUpperCase(), title: String(t.title).trim() }));

  return {
    id: body.id,
    title: body.title || '',
    originalTitle: body.original_title || body.title || '',
    originalLanguage: (body.original_language || '').toLowerCase(),
    overview: body.overview || '',
    runtime: body.runtime && body.runtime > 0 ? body.runtime : null,
    budget: body.budget && body.budget > 0 ? body.budget : null,
    releaseDate: body.release_date || null,
    year: body.release_date ? Number(body.release_date.slice(0, 4)) || null : null,
    genres: (body.genres ?? []).map((g) => ({ id: g.id, name: g.name })),
    countries: (body.production_countries ?? []).map((c) => ({
      iso: c.iso_3166_1,
      name: c.name,
    })),
    alternativeTitles: alt,
    certificationFi,
    credits: { directors, writers, composers, cast: actors },
  };
}
