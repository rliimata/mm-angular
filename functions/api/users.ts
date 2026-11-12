interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

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
): Promise<{ ok: true; authHeader: string } | { ok: false; response: Response }> {
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
    return { ok: false, response: json(request, 403, { error: 'Vain ylläpitäjä voi luoda käyttäjiä.' }) };
  }
  return { ok: true, authHeader: auth };
}

export const onRequestOptions: PagesFunction<Env> = async (context) =>
  new Response(null, { status: 204, headers: corsHeaders(context.request) });

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return json(request, 500, { error: 'Supabase-asetukset puuttuvat.' });
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(request, 500, { error: 'SUPABASE_SERVICE_ROLE_KEY puuttuu.' });
  }

  const auth = await requireSuperUser(request, env);
  if (!auth.ok) {
    return auth.response;
  }

  let body: {
    email?: string;
    password?: string;
    firstName?: string;
    lastName?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(request, 400, { error: 'Virheellinen pyyntö.' });
  }

  const email = String(body.email || '')
    .trim()
    .toLowerCase();
  const password = String(body.password || '');
  const firstName = String(body.firstName || '').trim();
  const lastName = String(body.lastName || '').trim();

  if (!email) {
    return json(request, 400, { error: 'Sähköposti on pakollinen.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(request, 400, { error: 'Anna kelvollinen sähköpostiosoite.' });
  }
  if (password.length < 6) {
    return json(request, 400, { error: 'Salasanan on oltava vähintään 6 merkkiä.' });
  }
  if (!firstName || !lastName) {
    return json(request, 400, { error: 'Etunimi ja sukunimi ovat pakollisia.' });
  }

  const createRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { firstName, lastName },
    }),
  });
  const createText = await createRes.text();
  let created: { id?: string; msg?: string; message?: string; error?: string } = {};
  try {
    created = JSON.parse(createText) as typeof created;
  } catch {
    /* plain text */
  }
  if (!createRes.ok || !created.id) {
    return json(request, createRes.status >= 400 ? createRes.status : 500, {
      error: created.msg || created.message || created.error || createText || 'Auth-käyttäjän luonti epäonnistui.',
    });
  }

  const maxRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/User?select=Id&order=Id.desc&limit=1`,
    {
      headers: {
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Accept: 'application/json',
      },
    }
  );
  if (!maxRes.ok) {
    return json(request, 500, { error: 'Käyttäjä-id:n haku epäonnistui.' });
  }
  const maxRows = (await maxRes.json()) as { Id: number }[];
  const nextId = (maxRows[0]?.Id ?? 0) + 1;
  if (nextId > 32767) {
    return json(request, 500, { error: 'Käyttäjä-id:t loppuivat.' });
  }

  const insertRes = await fetch(`${env.SUPABASE_URL}/rest/v1/User`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      Id: nextId,
      Email: email,
      FirstName: firstName,
      LastName: lastName,
      Pwd: '*',
      SuperUser: 0,
      AuthUserId: created.id,
      LastLogin: null,
    }),
  });
  const insertText = await insertRes.text();
  if (!insertRes.ok) {
    // Best-effort cleanup of the auth user if profile insert fails.
    await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${created.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      },
    });
    let errBody: { message?: string; error?: string } = {};
    try {
      errBody = JSON.parse(insertText) as typeof errBody;
    } catch {
      /* plain */
    }
    return json(request, 500, {
      error: errBody.message || errBody.error || insertText || 'Profiilin luonti epäonnistui.',
    });
  }

  return json(request, 200, { id: nextId, email, authUserId: created.id });
};
