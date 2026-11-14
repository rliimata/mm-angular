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

/** Supports TMDB v3 api_key or v4 Read Access Token (JWT). */
function tmdbFetch(path: string, apiKey: string, query: Record<string, string> = {}): Promise<Response> {
  const key = apiKey.trim();
  const url = new URL(`${TMDB_BASE}${path.startsWith('/') ? path : `/${path}`}`);
  for (const [k, v] of Object.entries(query)) {
    url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = { Accept: 'application/json' };
  // v4 read token looks like a JWT; v3 key is a short hex-ish string.
  if (key.startsWith('eyJ')) {
    headers.Authorization = `Bearer ${key}`;
  } else {
    url.searchParams.set('api_key', key);
  }
  return fetch(url.toString(), { headers });
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
      return json(request, res.status >= 400 ? res.status : 500, {
        error: body.status_message || text || 'TMDB-haku epäonnistui.',
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

  return json(request, 400, { error: 'Tuntematon action (search|providers).' });
};
