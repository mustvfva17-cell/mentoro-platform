import { authFailure, getAuthenticatedContext, readBody, sendJson } from '../lib/supabase-server.js';

export default async function handler(request, response) {
  const context = await getAuthenticatedContext(request);
  if (!context.ok) return authFailure(response, context);

  if (request.method === 'GET') {
    const { data, error } = await context.db
      .from('training_applications')
      .select('id,trainee_profile_id,offering_id,slot_id,applicant_note,status,mentor_decided_at,mentor_decision_reason,admin_decided_at,admin_decision_reason,created_at,updated_at')
      .order('created_at', { ascending: false }).limit(100);
    if (error) return sendJson(response, 503, { error: 'applications_unavailable' });
    return sendJson(response, 200, { applications: data || [] });
  }
  if (request.method !== 'POST') return sendJson(response, 405, { error: 'method_not_allowed' });

  const body = readBody(request);
  if (typeof body.offeringId !== 'string' || typeof body.slotId !== 'string') return sendJson(response, 400, { error: 'offering_and_slot_required' });
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : null;
  const { data, error } = await context.db.from('training_applications').insert({
    trainee_profile_id: context.user.id, offering_id: body.offeringId, slot_id: body.slotId, applicant_note: note || null
  }).select('id,status,created_at').single();
  if (error) return sendJson(response, 400, { error: 'application_not_created', detail: error.message });
  return sendJson(response, 201, { application: data });
}
