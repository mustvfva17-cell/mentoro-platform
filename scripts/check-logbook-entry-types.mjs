import { readFile } from 'node:fs/promises';

const frontend = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const migrationPath = new URL('../supabase/migrations/20261028061628_core_independent_enrollment_schema_v1.sql', import.meta.url);
let migration = null;

try {
  migration = await readFile(migrationPath, 'utf8');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const fallbackTypes = [
  'SESSION',
  'CASE',
  'PROCEDURE',
  'EMERGENCY',
  'REFLECTION',
  'ROADMAP',
  'LEARNING_ACTIVITY',
];

let allowedTypes = new Set(fallbackTypes);
if (migration !== null) {
  const match = migration.match(
    /entry_type\s+text\s+NOT NULL\s+CHECK\s*\(\s*entry_type\s+IN\s*\(([^)]+)\)\s*\)/is
  );
  if (!match) {
    throw new Error('Could not locate the logbook_entries.entry_type check constraint in the core migration.');
  }
  allowedTypes = new Set(Array.from(match[1].matchAll(/'([A-Z_]+)'/g), (item) => item[1]));
} else {
  console.warn('Core schema migration is not present on this branch; using the reviewed entry-type contract until migration recovery is merged.');
}

const usedTypes = Array.from(
  frontend.matchAll(/entry_type\s*:\s*['"]([A-Z_]+)['"]/g),
  (item) => item[1]
);

if (!usedTypes.length) {
  throw new Error('No literal logbook entry_type assignments were found in src/main.js.');
}

const invalid = [...new Set(usedTypes)].filter((type) => !allowedTypes.has(type));
if (invalid.length) {
  throw new Error(
    `Unsupported logbook entry type(s) in src/main.js: ${invalid.join(', ')}. Allowed: ${[...allowedTypes].join(', ')}.`
  );
}

const usesScopedSubmissionRpc = /supabase\.rpc\(['"]set_logbook_entry_submitted['"]/.test(frontend);
if (!usesScopedSubmissionRpc) {
  throw new Error('Logbook submission must use the scoped set_logbook_entry_submitted RPC.');
}

const submissionMigrationPath = new URL('../supabase/migrations/20261028094412_fix_scoped_logbook_submission_rpc.sql', import.meta.url);
let submissionMigration = null;
try {
  submissionMigration = await readFile(submissionMigrationPath, 'utf8');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const submissionSource = submissionMigration ?? migration;
if (submissionSource !== null) {
  const submitFunction = submissionSource.match(/CREATE OR REPLACE FUNCTION public\.set_logbook_entry_submitted\([\s\S]*?\$\$;?/i);
  if (submitFunction && /updated_at\s*=|submitted_at\s*=/i.test(submitFunction[0])) {
    throw new Error('Submission RPC must rely on database triggers for timestamps, not write timestamp columns directly.');
  }
}

const provisioningCallCount = frontend.split("supabase.rpc('provision_current_trainee'").length - 1;
const roleResolverCallCount = frontend.split('resolveWorkspaceRole(').length - 1;
if (provisioningCallCount !== 1 ||
    !frontend.includes("from('profile_roles')") ||
    !frontend.includes(".is('revoked_at', null)") ||
    !frontend.includes("roles.has('TRAINEE')") ||
    !frontend.includes("roles.has('MENTOR')") ||
    !frontend.includes("roles.has('ADMIN')") ||
    !frontend.includes("roles.has('SUPER_ADMIN')") ||
    !frontend.includes("if (role === 'MENTOR') return renderMentorDashboard(user);") ||
    !frontend.includes("import { renderAdminWorkspace } from './admin-workspace.js';") ||
    !frontend.includes("return renderAdminWorkspace({ user, supabase, shell, esc, dateTime, setBusy, message, errorText });") ||
    roleResolverCallCount !== 4) {
  throw new Error('Existing platform accounts must be role-checked and routed without cross-role provisioning.');
}
if (!frontend.includes("supabase.rpc('mentor_review_my_application'") ||
    !frontend.includes('data-mentor-decision="APPROVE"') ||
    !frontend.includes('data-mentor-decision="REJECT"')) {
  throw new Error('Mentor decisions must use the scoped current-user review RPC.');
}

if (!frontend.includes("supabase.rpc('mentor_list_my_logbook_entries'") ||
    !frontend.includes("supabase.rpc('mentor_review_my_entry'") ||
    !frontend.includes('data-entry-decision="VERIFIED"') ||
    !frontend.includes('data-entry-decision="FEEDBACK"') ||
    !frontend.includes('data-entry-decision="NEEDS_REVISION"') ||
    !frontend.includes("entry_reviews(decision,feedback,reviewed_at)") ||
    !frontend.includes(".update({ title, entry_date: entryDate })") ||
    !frontend.includes("message('Revision saved and resubmitted to your mentor.', 'success')")) {
  throw new Error('Mentor logbook review and trainee revision flow must use scoped RPCs and preserve review feedback.');
}

const mentorDashboardSource = frontend.match(
  /async function renderMentorDashboard\(user\) \{[\s\S]*?\n\}/
)?.[0] || '';
const mentorApplicationCardSource = frontend.match(
  /function mentorApplicationCard\(item\) \{[\s\S]*?\n\}/
)?.[0] || '';
if (!/supabase\.rpc\(['"]mentor_list_my_applications['"]/.test(mentorDashboardSource) ||
    mentorDashboardSource.includes("from('training_applications')") ||
    !mentorApplicationCardSource.includes("esc(item.trainee_name || 'Trainee')") ||
    !mentorApplicationCardSource.includes('esc(education)') ||
    !mentorApplicationCardSource.includes('item.mentor_decision_reason')) {
  throw new Error('Mentor application data must come from the scoped inbox RPC and render escaped applicant details.');
}

if (!frontend.includes('const instanceRelation = enrollment.logbook_instances;') ||
    !frontend.includes('Array.isArray(instanceRelation) ? instanceRelation[0] : instanceRelation')) {
  throw new Error('Logbook instance rendering must support one-to-one PostgREST embedding.');
}

if (!frontend.includes('const entries = [...(instance?.logbook_entries || [])].sort((a, b) =>') ||
    !frontend.includes("String(b.entry_date || '').localeCompare(String(a.entry_date || ''))")) {
  throw new Error('Logbook entries must be sorted newest-first because nested query ordering is not guaranteed.');
}

const localDateContract = frontend.includes('const localDateISO = () => {') &&
  frontend.includes('now.getFullYear()') &&
  frontend.includes('now.getMonth() + 1') &&
  frontend.includes('now.getDate()') &&
  frontend.includes('value="${localDateISO()}"') &&
  !frontend.includes('new Date().toISOString().slice(0,10)');
if (!localDateContract) {
  throw new Error('Logbook default date must use the trainee local calendar date, not UTC.');
}

const startupSource = frontend.match(/async function start\(\) \{[\s\S]*?\n\}/)?.[0] || '';
if (!startupSource.includes('error: sessionError') ||
    !startupSource.includes('if (sessionError) throw sessionError;') ||
    !startupSource.includes("message(errorText(error), 'error');")) {
  throw new Error('Auth startup must handle session restoration failures with a visible message.');
}

const offeringsErrorBlock = frontend.match(/if \(error\) \{\s*target\.innerHTML = '[^']*Training listings are temporarily unavailable[^']*';[\s\S]*?return;\s*\}/);
if (!offeringsErrorBlock ||
    !offeringsErrorBlock[0].includes('retry-offerings') ||
    !offeringsErrorBlock[0].includes('loadOfferings(user, isVerified)')) {
  throw new Error('Training listing failures must expose a working retry action.');
}

if (!frontend.includes("const accountStatus = profile.account_status || 'PENDING';") ||
    !frontend.includes("esc(accountStatus.replaceAll('_', ' '))")) {
  throw new Error('Dashboard rendering must tolerate a missing account status without crashing.');
}

console.log('Account-role entry and one-to-one logbook embedding contracts passed.');
console.log(`Logbook entry-type and scoped-submission contracts passed: ${[...new Set(usedTypes)].join(', ')}.`);
