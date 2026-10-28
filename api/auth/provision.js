import { authFailure, getAuthenticatedContext, readBody, requireMethod, sendJson } from '../../lib/supabase-server.js';

export default async function handler(request, response) {
  if (!requireMethod(request, response, 'POST')) return;
  const context = await getAuthenticatedContext(request);
  if (!context.ok) return authFailure(response, context);

  if (!context.user.email_confirmed_at) {
    return sendJson(response, 403, { error: 'email_verification_required' });
  }
  const body = readBody(request);
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim().slice(0, 160) : null;
  const { data, error } = await context.db.rpc('provision_current_trainee', { p_full_name: fullName || null });
  if (error) return sendJson(response, 400, { error: 'profile_provisioning_failed', detail: error.message });
  return sendJson(response, 200, { profileId: data });
}
