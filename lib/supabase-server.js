import { createClient } from '@supabase/supabase-js';

export function sendJson(response, status, body) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  return response.status(status).json(body);
}

export function readBody(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  if (typeof request.body === 'string') {
    try { return JSON.parse(request.body); } catch { return {}; }
  }
  return {};
}

export function methodNotAllowed(response, methods) {
  response.setHeader('Allow', methods.join(', '));
  return sendJson(response, 405, { error: 'method_not_allowed' });
}

function baseClientOptions() {
  return {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  };
}

export function makePublicClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, baseClientOptions());
}

export async function getAuthenticatedContext(request) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return { ok: false, status: 503, error: 'supabase_configuration_missing' };

  const authorization = request.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) return { ok: false, status: 401, error: 'authentication_required' };

  try {
    const verifyClient = createClient(url, key, baseClientOptions());
    const { data, error } = await verifyClient.auth.getUser(match[1]);
    if (error || !data?.user) return { ok: false, status: 401, error: 'invalid_or_expired_session' };

    // Every subsequent PostgREST request carries the verified user's JWT so
    // auth.uid() and RLS evaluate the actual user rather than a server role.
    const db = createClient(url, key, {
      ...baseClientOptions(),
      global: { headers: { Authorization: `Bearer ${match[1]}` } }
    });

    const [profileResult, rolesResult] = await Promise.all([
      db.from('profiles').select('id,email,full_name,account_status,verified_at,verification_reason').eq('id', data.user.id).maybeSingle(),
      db.from('profile_roles').select('role').eq('user_id', data.user.id).is('revoked_at', null)
    ]);
    if (profileResult.error || rolesResult.error) {
      return { ok: false, status: 503, error: 'profile_context_unavailable' };
    }

    return {
      ok: true, db, token: match[1], user: data.user,
      profile: profileResult.data || null,
      roles: (rolesResult.data || []).map(row => row.role)
    };
  } catch {
    return { ok: false, status: 503, error: 'auth_verification_unavailable' };
  }
}

export function requireRoles(context, allowed) {
  return context.roles.some(role => allowed.includes(role));
}

export function authFailure(response, context) {
  return sendJson(response, context.status || 401, { error: context.error || 'request_not_authorized' });
}

export function requireMethod(request, response, method) {
  if (request.method !== method) {
    methodNotAllowed(response, [method]);
    return false;
  }
  return true;
}
