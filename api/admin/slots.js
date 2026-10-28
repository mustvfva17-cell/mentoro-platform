import { authFailure, getAuthenticatedContext, readBody, requireMethod, requireRoles, sendJson } from '../../lib/supabase-server.js';

export default async function handler(request, response) {
  if (!requireMethod(request, response, 'POST')) return;
  const context = await getAuthenticatedContext(request);
  if (!context.ok) return authFailure(response, context);
  if (!requireRoles(context, ['ADMIN', 'SUPER_ADMIN'])) return sendJson(response, 403, { error: 'admin_role_required' });

  const body = readBody(request);
  if (typeof body.offeringId !== 'string' || typeof body.startsAt !== 'string' || typeof body.endsAt !== 'string') {
    return sendJson(response, 400, { error: 'offering_and_slot_dates_required' });
  }
  const capacity = Number(body.capacity ?? 1);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000) return sendJson(response, 400, { error: 'invalid_capacity' });
  const { data, error } = await context.db.rpc('admin_create_training_slot', {
    p_offering_id: body.offeringId, p_starts_at: body.startsAt, p_ends_at: body.endsAt, p_capacity: capacity
  });
  if (error) return sendJson(response, 400, { error: 'slot_creation_failed', detail: error.message });
  return sendJson(response, 201, { slotId: data });
}
