interface Env {
  MEDIA: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

const PUBLIC_BASE = 'https://pub-c0accf14a0674569abe285ec68c729fd.r2.dev';

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

async function requireSuperUser(
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
  const user = (await userRes.json()) as { id?: string };
  if (!user.id) {
    return { ok: false, response: json(request, 401, { error: 'Käyttäjää ei löytynyt.' }) };
  }

  const profileRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/Profile?AuthUserId=eq.${encodeURIComponent(user.id)}&select=SuperUser`,
    {
      headers: {
        Authorization: auth,
        apikey: env.SUPABASE_ANON_KEY,
        Accept: 'application/json',
      },
    }
  );
  if (!profileRes.ok) {
    return { ok: false, response: json(request, 403, { error: 'Profiilin tarkistus epäonnistui.' }) };
  }
  const rows = (await profileRes.json()) as { SuperUser?: number }[];
  if (!rows[0] || rows[0].SuperUser !== 1) {
    return { ok: false, response: json(request, 403, { error: 'Vain ylläpitäjä voi vaihtaa kuvia.' }) };
  }
  return { ok: true };
}

export const onRequestOptions: PagesFunction<Env> = async (context) =>
  new Response(null, { status: 204, headers: corsHeaders(context.request) });

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  if (!env.MEDIA) {
    return json(request, 500, { error: 'R2-binding MEDIA puuttuu.' });
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return json(request, 500, { error: 'Supabase-asetukset puuttuvat.' });
  }

  const auth = await requireSuperUser(request, env);
  if (!auth.ok) {
    return auth.response;
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(request, 400, { error: 'Virheellinen pyyntö.' });
  }

  const kind = String(form.get('kind') || '');
  const id = Number(form.get('id'));
  const file = form.get('file');

  if (kind !== 'movies' && kind !== 'persons') {
    return json(request, 400, { error: 'kind tulee olla movies tai persons.' });
  }
  if (!Number.isFinite(id) || id <= 0) {
    return json(request, 400, { error: 'Virheellinen id.' });
  }
  if (!(file instanceof File)) {
    return json(request, 400, { error: 'Tiedosto puuttuu.' });
  }
  if (!file.type.startsWith('image/')) {
    return json(request, 400, { error: 'Vain kuvatiedostot sallitaan.' });
  }
  if (file.size > 8 * 1024 * 1024) {
    return json(request, 400, { error: 'Kuva on liian suuri (max 8 Mt).' });
  }

  const key = `${kind}/${id}.jpg`;
  const bust = Date.now();
  await env.MEDIA.put(key, file.stream(), {
    httpMetadata: {
      contentType: file.type || 'image/jpeg',
      // Same key is overwritten — avoid long-lived browser/CDN stale copies.
      cacheControl: 'public, max-age=0, must-revalidate',
    },
    customMetadata: {
      updatedAt: String(bust),
    },
  });

  return json(request, 200, {
    key,
    url: `${PUBLIC_BASE}/${key}?t=${bust}`,
    t: bust,
  });
};
