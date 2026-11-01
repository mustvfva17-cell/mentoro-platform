/**
 * Persistence boundary for specialty modules.
 *
 * Production implementation must call the authenticated platform API.
 * Do not use specialty-specific localStorage keys as a source of truth.
 * Any future offline cache must be instance-namespaced and reconciled by
 * the trusted API; browser-provided ownership and role claims are untrusted.
 */
export const LOGBOOK_STORAGE_CONTRACT = Object.freeze({
  read: "GET /api/logbooks/:logbookId/state",
  write: "PUT /api/logbooks/:logbookId/state",
  appendEntry: "POST /api/logbooks/:logbookId/entries",
  listEntries: "GET /api/logbooks/:logbookId/entries",
  listReviews: "GET /api/logbooks/:logbookId/reviews",
  authority: "authenticated-platform-api",
});
