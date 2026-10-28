import { authFailure, getAuthenticatedContext, requireMethod, requireRoles, sendJson } from '../../lib/supabase-server.js';

export default async function handler(request, response) {
  if (!requireMethod(request, response, 'GET')) return;
  const context = await getAuthenticatedContext(request);
  if (!context.ok) return authFailure(response, context);
  if (!requireRoles(context, ['ADMIN', 'SUPER_ADMIN'])) return sendJson(response, 403, { error: 'admin_role_required' });

  const { data: profiles, error: profileError } = await context.db
    .from('profiles')
    .select('id,email,full_name,account_status,created_at,verified_at')
    .in('account_status', ['PENDING_VERIFICATION', 'REJECTED'])
    .order('created_at', { ascending: true })
    .limit(100);
  if (profileError) return sendJson(response, 503, { error: 'verification_queue_unavailable' });
  if (!profiles?.length) return sendJson(response, 200, { verifications: [] });

  const ids = profiles.map(row => row.id);
  const { data: docs, error: docsError } = await context.db
    .from('verification_documents')
    .select('id,trainee_profile_id,document_type,status,object_path,review_note,created_at')
    .in('trainee_profile_id', ids)
    .order('created_at', { ascending: false });
  if (docsError) return sendJson(response, 503, { error: 'verification_documents_unavailable' });

  const latestDoc = new Map();
  for (const doc of docs || []) if (!latestDoc.has(doc.trainee_profile_id)) latestDoc.set(doc.trainee_profile_id, doc);
  return sendJson(response, 200, { verifications: profiles.map(profile => ({ ...profile, document: latestDoc.get(profile.id) || null })) });
}
