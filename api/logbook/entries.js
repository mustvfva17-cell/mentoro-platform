import { authFailure, getAuthenticatedContext, readBody, sendJson } from '../../lib/supabase-server.js';

const ENTRY_TYPES = new Set(['SESSION', 'CASE', 'PROCEDURE', 'EMERGENCY', 'REFLECTION', 'ROADMAP', 'LEARNING_ACTIVITY']);

export default async function handler(request, response) {
  const context = await getAuthenticatedContext(request);
  if (!context.ok) return authFailure(response, context);

  if (request.method === 'GET') {
    const instanceId = typeof request.query?.instanceId === 'string' ? request.query.instanceId : '';
    if (!instanceId) return sendJson(response, 400, { error: 'instance_id_required' });
    const { data, error } = await context.db
      .from('logbook_entries')
      .select('id,instance_id,entry_type,title,entry_date,payload,status,submitted_at,created_at,updated_at')
      .eq('instance_id', instanceId)
      .order('entry_date', { ascending: false })
      .limit(200);
    if (error) return sendJson(response, 503, { error: 'logbook_entries_unavailable' });
    return sendJson(response, 200, { entries: data || [] });
  }

  if (request.method !== 'POST') return sendJson(response, 405, { error: 'method_not_allowed' });
  const body = readBody(request);
  if (typeof body.instanceId !== 'string' || !ENTRY_TYPES.has(body.entryType)) return sendJson(response, 400, { error: 'invalid_logbook_entry' });
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 180) : '';
  const entryDate = typeof body.entryDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.entryDate) ? body.entryDate : new Date().toISOString().slice(0, 10);
  const payload = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload) ? body.payload : {};
  if (JSON.stringify(payload).length > 30000) return sendJson(response, 413, { error: 'payload_too_large' });

  const { data, error } = await context.db
    .from('logbook_entries')
    .insert({
      instance_id: body.instanceId,
      entry_type: body.entryType,
      title,
      entry_date: entryDate,
      payload,
      created_by: context.user.id
    })
    .select('id,instance_id,entry_type,title,entry_date,payload,status,created_at')
    .single();
  if (error) return sendJson(response, 400, { error: 'logbook_entry_not_created', detail: error.message });
  return sendJson(response, 201, { entry: data });
}
