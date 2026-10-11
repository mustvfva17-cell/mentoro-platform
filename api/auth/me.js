import { createClient } from '@supabase/supabase-js';

function send(response, status, body) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.status(status).json(body);
}

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return send(response, 405, { error: 'method_not_allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !publishableKey) {
    return send(response, 503, { error: 'auth_configuration_missing' });
  }

  const authorization = request.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) {
    return send(response, 401, { error: 'authentication_required' });
  }

  try {
    const supabase = createClient(supabaseUrl, publishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });

    // getUser(token) verifies the token with Supabase Auth; do not trust
    // user IDs or role labels supplied in the request body.
    const { data, error } = await supabase.auth.getUser(match[1]);
    if (error || !data?.user) {
      return send(response, 401, { error: 'invalid_or_expired_session' });
    }

    return send(response, 200, {
      authenticated: true,
      user: {
        id: data.user.id,
        email: data.user.email ?? null,
        emailVerified: Boolean(data.user.email_confirmed_at)
      }
    });
  } catch {
    // Avoid returning provider details, tokens, or internal errors to clients.
    return send(response, 503, { error: 'auth_verification_unavailable' });
  }
}
