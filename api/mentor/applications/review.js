import { authFailure, getAuthenticatedContext, readBody, requireMethod, requireRoles, sendJson } from '../../../lib/supabase-server.js';

export default async function handler(request, response) {
  if (!requireMethod(request, response, 'POST')) return;
  const context = await getAuthenticatedContext(request);
  if (!context.ok) return authFailure(response, context);
  if (!requireRoles(context, ['MENTOR', 'ADMIN', 'SUPER_ADMIN'])) {
    return sendJson(response, 403, { error: 'mentor_or_admin_role_required' });
  }

  const body = readBody(request);
  if (typeof body.applicationId !== 'string' || !['APPROVE', 'REJECT'].includes(body.decision)) {
    return sendJson(response, 400, { error: 'invalid_review_request' });
  }
  const { data, error } = await context.db.rpc('mentor_review_my_application', {
    p_application_id: body.applicationId,
    p_decision: body.decision,
    p_reason: typeof body.reason === 'string' ? body.reason.trim().slice(0, 1000) || null : null
  });
  if (error) return sendJson(response, 400, { error: 'mentor_review_failed', detail: error.message });
  return sendJson(response, 200, { applicationId: data });
}
