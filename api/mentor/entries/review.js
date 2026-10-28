import { authFailure, getAuthenticatedContext, readBody, requireMethod, requireRoles, sendJson } from '../../../lib/supabase-server.js';

export default async function handler(request, response) {
  if (!requireMethod(request, response, 'POST')) return;
  const context = await getAuthenticatedContext(request);
  if (!context.ok) return authFailure(response, context);
  if (!requireRoles(context, ['MENTOR', 'ADMIN', 'SUPER_ADMIN'])) return sendJson(response, 403, { error: 'mentor_or_admin_role_required' });

  const body = readBody(request);
  if (typeof body.entryId !== 'string' || !['VERIFIED', 'FEEDBACK', 'NEEDS_REVISION'].includes(body.decision)) {
    return sendJson(response, 400, { error: 'invalid_entry_review' });
  }
  const { data, error } = await context.db.from('entry_reviews').insert({
    entry_id: body.entryId,
    reviewer_profile_id: context.user.id,
    decision: body.decision,
    feedback: typeof body.feedback === 'string' ? body.feedback.trim().slice(0, 2500) || null : null
  }).select('id,entry_id,decision,feedback,reviewed_at').single();
  if (error) return sendJson(response, 400, { error: 'entry_review_failed', detail: error.message });
  return sendJson(response, 201, { review: data });
}
