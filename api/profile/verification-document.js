import { authFailure, getAuthenticatedContext, readBody, requireMethod, sendJson } from '../../lib/supabase-server.js';

export default async function handler(request, response) {
  if (!requireMethod(request, response, 'POST')) return;
  const context = await getAuthenticatedContext(request);
  if (!context.ok) return authFailure(response, context);

  const body = readBody(request);
  const objectPath = typeof body.objectPath === 'string' ? body.objectPath.trim() : '';
  const documentType = typeof body.documentType === 'string' ? body.documentType : 'UNIVERSITY_ID';
  if (!objectPath || objectPath.length > 500) return sendJson(response, 400, { error: 'invalid_object_path' });

  const { data, error } = await context.db.rpc('record_verification_document', {
    p_object_path: objectPath,
    p_document_type: documentType
  });
  if (error) return sendJson(response, 400, { error: 'verification_document_not_recorded', detail: error.message });
  return sendJson(response, 201, { documentId: data });
}
