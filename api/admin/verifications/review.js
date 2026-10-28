import { authFailure, getAuthenticatedContext, readBody, requireMethod, requireRoles, sendJson } from '../../../lib/supabase-server.js';

export default async function handler(request, response) {
  if (!requireMethod(request, response, 'POST')) return;
  const context = await getAuthenticatedContext(request);
  if (!context.ok) return authFailure(response, context);
  if (!requireRoles(context, ['ADMIN', 'SUPER_ADMIN'])) return sendJson(response, 403, { error: 'admin_role_required' });

  const body = readBody(request);
  if (typeof body.traineeProfileId !== 'string' || typeof body.documentId !== 'string' || !['APPROVE', 'REJECT'].includes(body.decision)) {
    return sendJson(response, 400, { error: 'invalid_verification_decision' });
  }
  const { data, error } = await context.db.rpc('admin_review_trainee_verification', {
    p_trainee_profile_id: body.traineeProfileId,
    p_document_id: body.documentId,
    p_decision: body.decision,
    p_reason: typeof body.reason === 'string' ? body.reason.trim().slice(0, 1000) || null : null
  });
  if (error) return sendJson(response, 400, { error: 'verification_review_failed', detail: error.message });
  return sendJson(response, 200, { traineeProfileId: data });
}
