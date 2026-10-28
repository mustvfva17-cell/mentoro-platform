import { authFailure, getAuthenticatedContext, readBody, requireMethod, sendJson } from '../../../lib/supabase-server.js';

export default async function handler(request, response) {
  if (!requireMethod(request, response, 'POST')) return;
  const context = await getAuthenticatedContext(request);
  if (!context.ok) return authFailure(response, context);
  const body = readBody(request);
  if (typeof body.entryId !== 'string') return sendJson(response, 400, { error: 'entry_id_required' });

  const { data, error } = await context.db.rpc('set_logbook_entry_submitted', {
    p_actor_id: context.user.id,
    p_entry_id: body.entryId
  });
  if (error) return sendJson(response, 400, { error: 'entry_submission_failed', detail: error.message });
  return sendJson(response, 200, { entryId: data, status: 'SUBMITTED' });
}
