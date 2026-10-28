import { createClient } from '@supabase/supabase-js';
import './style.css';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const configured = Boolean(SUPABASE_URL && SUPABASE_KEY);
const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
}) : null;

const app = document.querySelector('#app');
const state = {
  mode: 'login',
  session: null,
  user: null,
  profile: null,
  roles: [],
  offers: [],
  applications: [],
  enrollments: [],
  selectedInstanceId: null,
  entries: [],
  mentorApplications: [],
  mentorEntries: [],
  verifications: [],
  adminApplications: [],
  catalog: null,
  busy: false,
  toast: null,
  loadRevision: 0
};

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

const fmtDate = value => {
  if (!value) return 'Not scheduled';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? esc(value) : date.toLocaleString(undefined, {
    dateStyle: 'medium', timeStyle: 'short'
  });
};

const fmtDay = value => {
  if (!value) return '';
  const date = new Date(value + (String(value).length === 10 ? 'T00:00:00' : ''));
  return Number.isNaN(date.getTime()) ? esc(value) : date.toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric'
  });
};

const hasRole = (...roles) => roles.some(role => state.roles.includes(role));
const isAdmin = () => hasRole('ADMIN', 'SUPER_ADMIN');
const isMentor = () => hasRole('MENTOR');
const isVerified = () => state.profile?.account_status === 'VERIFIED';

function notify(message, type = 'info') {
  state.toast = { message, type };
  render();
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.session?.access_token) headers.Authorization = `Bearer ${state.session.access_token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.detail || data.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.code = data.error;
    throw error;
  }
  return data;
}

async function publicGet(path) {
  const response = await fetch(path, { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The public catalogue is temporarily unavailable.');
  return data;
}

function statusPill(value) {
  const text = String(value || 'UNKNOWN').replaceAll('_', ' ').toLowerCase();
  const cls = String(value || '').toLowerCase().replaceAll('_', '-');
  return `<span class="pill pill-${esc(cls)}">${esc(text)}</span>`;
}

function shellHeader() {
  return `
    <header class="topbar">
      <a class="brand" href="/" aria-label="MENTORO home">
        <span class="brand-mark" aria-hidden="true"><span></span><span></span></span>
        <span class="brand-word">mentoro<span>o</span></span>
      </a>
      <div class="topbar-right">
        <span class="environment-pill"><span class="env-dot"></span> Test environment</span>
        ${state.session ? `
          <span class="account-chip"><span class="avatar">${esc((state.profile?.full_name || state.user?.email || 'M').slice(0,1).toUpperCase())}</span>
          <span class="account-label">${esc(state.profile?.full_name || state.user?.email || 'Signed in')}</span></span>
          <button class="btn btn-quiet btn-small" data-action="sign-out">Sign out</button>
        ` : ''}
      </div>
    </header>`;
}

function renderConfigError() {
  app.innerHTML = `
    <div class="page-shell">${shellHeader()}
      <main class="narrow-main">
        <div class="notice notice-warning">
          <span class="notice-icon">!</span>
          <div><h2>Preview configuration is missing</h2>
          <p>The test preview needs <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>. No privileged database key belongs in the browser.</p></div>
        </div>
        <p class="muted">The database work is isolated from production. Once the Preview environment variables are connected, signup and sign-in can be tested here.</p>
      </main>
    </div>`;
}

function renderAuth() {
  const signUp = state.mode === 'signup';
  const offers = state.offers.length ? `
    <section class="public-preview">
      <div class="section-heading"><p class="eyebrow">MENTORO TRAINING DIRECTORY</p><h2>Explore clinical training</h2></div>
      <p class="muted">Public offerings appear here after a mentor and an approved, versioned logbook template are published.</p>
      ${renderOfferList(true)}
    </section>` : '';
  app.innerHTML = `
    <div class="page-shell">
      ${shellHeader()}
      <main class="auth-layout">
        <section class="auth-intro">
          <p class="eyebrow">MEDICAL TRAINING, WITH DIRECTION</p>
          <h1>Your clinical journey,<br><span>better connected.</span></h1>
          <p class="lead">Structured mentorship. Real clinical exposure. A separate logbook for every training.</p>
          <div class="feature-row"><span class="feature-icon">01</span><div><strong>One account</strong><p>Manage all your trainings in one place.</p></div></div>
          <div class="feature-row"><span class="feature-icon">02</span><div><strong>Independent logbooks</strong><p>Your progress and mentor reviews stay tied to the right training.</p></div></div>
          <div class="feature-row"><span class="feature-icon">03</span><div><strong>Verified access</strong><p>University identity is reviewed before a training application can be submitted.</p></div></div>
        </section>
        <section class="auth-card">
          <div class="auth-card-head">
            <span class="overline">${signUp ? 'GET STARTED' : 'WELCOME BACK'}</span>
            <h2>${signUp ? 'Create your account' : 'Sign in to MENTORO'}</h2>
            <p>${signUp ? 'Start with your personal account. Training access follows identity verification.' : 'Continue to your training dashboard.'}</p>
          </div>
          <form id="auth-form" class="form-stack">
            ${signUp ? `<label>Full name<input name="fullName" autocomplete="name" maxlength="160" placeholder="Your full name" required></label>` : ''}
            <label>Email address<input type="email" name="email" autocomplete="email" placeholder="name@example.com" required></label>
            <label>Password<input type="password" name="password" autocomplete="${signUp ? 'new-password' : 'current-password'}" minlength="8" placeholder="${signUp ? 'At least 8 characters' : 'Your password'}" required></label>
            ${signUp ? '<p class="field-note">Use an email address you can access; email confirmation may be required before your account is created.</p>' : ''}
            <button class="btn btn-primary btn-block" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Please wait…' : signUp ? 'Create account' : 'Sign in'} <span aria-hidden="true">→</span></button>
          </form>
          <div class="auth-switch">${signUp ? 'Already registered?' : 'New to MENTORO?'} <button class="text-button" type="button" data-action="toggle-auth">${signUp ? 'Sign in' : 'Create an account'}</button></div>
          <p class="privacy-note"><span aria-hidden="true">◆</span> Training applications require an approved account. Do not enter patient-identifying information into logbooks.</p>
        </section>
      </main>
      ${offers}
      ${renderToast()}
      <footer class="footer"><span>mentoro</span><span>Built for safer, more structured medical training.</span></footer>
    </div>`;
}

function renderOfferList(preview = false) {
  if (!state.offers.length) {
    return `<div class="empty-state"><span class="empty-icon">◎</span><strong>No published training slots yet</strong><p>Offerings will appear after the specialty template and mentor-led training have been approved.</p></div>`;
  }
  return `<div class="offer-grid">${state.offers.map(offer => `
    <article class="offer-card">
      <div class="offer-card-top"><span class="specialty-tag">${esc(offer.specialty?.name_en || 'Clinical training')}</span><span class="slot-count">${offer.slots.length} open slot${offer.slots.length === 1 ? '' : 's'}</span></div>
      <h3>${esc(offer.title)}</h3>
      <p class="muted">${esc(offer.description || 'Structured clinical exposure and mentorship.')}</p>
      <div class="mentor-line"><span class="mentor-avatar">${esc((offer.mentor?.display_name || 'M').slice(0,1).toUpperCase())}</span><div><strong>${esc(offer.mentor?.display_name || 'Mentor')}</strong><small>${esc(offer.mentor?.professional_title || offer.mentor?.institution || 'MENTORO mentor')}</small></div></div>
      <div class="slot-list">${offer.slots.map(slot => `
        <div class="slot-row"><div><strong>${esc(fmtDate(slot.starts_at))}</strong><small>Ends ${esc(fmtDate(slot.ends_at))}</small></div>
        ${preview ? '' : `<button class="btn btn-outline btn-small" data-action="apply" data-offering-id="${esc(offer.id)}" data-slot-id="${esc(slot.id)}" ${!isVerified() ? 'disabled title="Verify your account before applying"' : ''}>Apply</button>`}
        </div>`).join('')}</div>
      ${preview ? '' : (!isVerified() ? '<p class="field-note">Verify your account before submitting a training application.</p>' : '')}
    </article>`).join('')}</div>`;
}

function renderApplications(applications = state.applications) {
  if (!applications?.length) return '<div class="empty-state compact"><strong>No applications yet</strong><p>When you apply to a training, its status will appear here.</p></div>';
  const offeringById = new Map(state.offers.map(row => [row.id, row]));
  return `<div class="stack-list">${applications.map(row => {
    const offering = offeringById.get(row.offering_id);
    return `<article class="list-card"><div class="list-card-main"><strong>${esc(offering?.title || 'Training application')}</strong><p class="muted small-text">Submitted ${esc(fmtDate(row.created_at))}</p><p class="small-text muted">Application ID: <code>${esc(row.id)}</code></p></div><div class="list-card-side">${statusPill(row.status)}</div></article>`;
  }).join('')}</div>`;
}

function renderEnrollments() {
  if (!state.enrollments.length) return '<div class="empty-state compact"><strong>No confirmed trainings yet</strong><p>Once a booking is confirmed by MENTORO administration, a new independent logbook is created for it.</p></div>';
  return `<div class="enrollment-grid">${state.enrollments.map(row => `
    <article class="enrollment-card">
      <div class="enrollment-header"><span class="specialty-tag">${esc(row.specialty?.name_en || 'Training')}</span>${statusPill(row.status)}</div>
      <h3>${esc(row.offering?.title || row.specialty?.name_en || 'Clinical training')}</h3>
      <div class="detail-line"><span>Mentor</span><strong>${esc(row.mentor?.display_name || 'Assigned mentor')}</strong></div>
      <div class="detail-line"><span>Period</span><strong>${esc(fmtDate(row.starts_at))}</strong></div>
      <div class="detail-line"><span>Logbook</span><strong>${row.logbookInstance ? 'Created' : 'Pending creation'}</strong></div>
      ${row.logbookInstance ? `<button class="btn btn-primary btn-block" data-action="open-logbook" data-instance-id="${esc(row.logbookInstance.id)}">${state.selectedInstanceId === row.logbookInstance.id ? 'Logbook selected ✓' : 'Open this logbook'} <span aria-hidden="true">→</span></button>` : ''}
      <p class="tiny-note">This logbook belongs only to this training enrollment.</p>
    </article>`).join('')}</div>`;
}

function renderEntries() {
  const enrollment = state.enrollments.find(row => row.logbookInstance?.id === state.selectedInstanceId);
  if (!enrollment) return '';
  const canWrite = enrollment.trainee_profile_id === state.user?.id && ['CONFIRMED','ACTIVE'].includes(enrollment.status);
  return `
    <section class="panel logbook-panel">
      <div class="panel-heading"><div><p class="eyebrow">YOUR TRAINING RECORD</p><h2>${esc(enrollment.offering?.title || enrollment.specialty?.name_en || 'Training logbook')}</h2><p class="muted">Mentor: ${esc(enrollment.mentor?.display_name || 'Assigned mentor')} · ${esc(enrollment.specialty?.name_en || '')}</p></div><button class="btn btn-quiet btn-small" data-action="close-logbook">Close</button></div>
      ${canWrite ? `
        <form id="entry-form" class="entry-form">
          <div class="form-grid">
            <label>Entry type<select name="entryType" required><option value="SESSION">Clinical session</option><option value="CASE">Case reflection</option><option value="PROCEDURE">Procedure</option><option value="EMERGENCY">Emergency exposure</option><option value="LEARNING_ACTIVITY">Learning activity</option><option value="ROADMAP">Roadmap item</option><option value="REFLECTION">Reflection</option></select></label>
            <label>Date<input type="date" name="entryDate" value="${new Date().toISOString().slice(0,10)}" required></label>
          </div>
          <label>Short title<input name="title" maxlength="180" placeholder="e.g. Observed an abdominal examination" required></label>
          <label>Learning note<textarea name="notes" rows="3" maxlength="8000" placeholder="Describe what you learned. Do not include patient names, IDs, exact contact details, or other identifying information."></textarea></label>
          <div class="form-actions"><span class="field-note">Saved as a draft. Submitting an entry makes it available for mentor review.</span><button class="btn btn-primary" type="submit" ${state.busy ? 'disabled' : ''}>Save draft</button></div>
        </form>` : '<div class="notice notice-neutral"><div><strong>Read-only view</strong><p>This logbook is available to you for review, but you are not its trainee owner.</p></div></div>'}
      <div class="entry-list">
        <div class="subsection-title"><h3>Recorded entries</h3><span class="muted small-text">${state.entries.length} total</span></div>
        ${state.entries.length ? state.entries.map(entry => `
          <article class="entry-card">
            <div class="entry-heading"><div><span class="entry-type">${esc(String(entry.entry_type).replaceAll('_',' '))}</span><h4>${esc(entry.title || 'Untitled entry')}</h4><small>${esc(fmtDay(entry.entry_date))}</small></div>${statusPill(entry.status)}</div>
            ${entry.payload?.notes ? `<p class="entry-note">${esc(entry.payload.notes)}</p>` : ''}
            ${entry.status === 'DRAFT' && canWrite ? `<div class="entry-actions"><button class="btn btn-outline btn-small" data-action="submit-entry" data-entry-id="${esc(entry.id)}">Submit for review</button></div>` : ''}
          </article>`).join('') : '<div class="empty-state compact"><strong>No entries in this logbook</strong><p>New bookings start with a clean logbook; entries from other trainings are not copied here.</p></div>'}
      </div>
    </section>`;
}

function renderMentorPanel() {
  if (!isMentor()) return '';
  const apps = state.mentorApplications.filter(row => row.status === 'SUBMITTED');
  return `
    <section class="panel" id="mentor-panel">
      <div class="panel-heading"><div><p class="eyebrow">MENTOR WORKSPACE</p><h2>Applications to review</h2><p class="muted">Only requests for your own mentor-led offerings can be acted on.</p></div><span class="count-bubble">${apps.length}</span></div>
      ${apps.length ? `<div class="stack-list">${apps.map(row => {
        const offering = state.offers.find(item => item.id === row.offering_id);
        return `<article class="review-card">
          <div class="list-card-main"><strong>${esc(offering?.title || 'Training application')}</strong><p class="muted small-text">Submitted ${esc(fmtDate(row.created_at))}</p><p class="small-text">Trainee reference: <code>${esc(row.trainee_profile_id)}</code></p>${row.applicant_note ? `<p>${esc(row.applicant_note)}</p>` : ''}</div>
          <div class="button-row"><button class="btn btn-primary btn-small" data-action="review-application" data-application-id="${esc(row.id)}" data-decision="APPROVE">Approve</button><button class="btn btn-danger-quiet btn-small" data-action="review-application" data-application-id="${esc(row.id)}" data-decision="REJECT">Decline</button></div>
        </article>`;
      }).join('')}</div>` : '<div class="empty-state compact"><strong>No requests awaiting your review</strong><p>Requests for your published offerings will appear here.</p></div>'}
      <div class="panel-divider"></div>
      <div class="panel-heading"><div><h3>Submitted logbook entries</h3><p class="muted small-text">Review is restricted to enrollments where you are the assigned mentor.</p></div></div>
      ${state.mentorEntries.length ? `<div class="stack-list">${state.mentorEntries.map(entry => `
        <article class="review-card">
          <div class="list-card-main"><span class="entry-type">${esc(String(entry.entry_type).replaceAll('_',' '))}</span><strong>${esc(entry.title || 'Untitled entry')}</strong><p class="muted small-text">${esc(fmtDay(entry.entry_date))} · Enrollment <code>${esc(entry.enrollment_id)}</code></p>${entry.payload?.notes ? `<p>${esc(entry.payload.notes)}</p>` : ''}</div>
          <div class="review-controls"><select id="review-decision-${esc(entry.id)}" aria-label="Review decision"><option value="VERIFIED">Verified</option><option value="FEEDBACK">Feedback</option><option value="NEEDS_REVISION">Needs revision</option></select><input id="review-feedback-${esc(entry.id)}" placeholder="Optional feedback" maxlength="2500"><button class="btn btn-outline btn-small" data-action="review-entry" data-entry-id="${esc(entry.id)}">Save review</button></div>
        </article>`).join('')}</div>` : '<div class="empty-state compact"><strong>No submitted entries</strong><p>Entries submitted by your trainees will appear here.</p></div>'}
    </section>`;
}

function renderAdminPanel() {
  if (!isAdmin()) return '';
  const cat = state.catalog;
  return `
    <section class="panel" id="admin-panel">
      <div class="panel-heading"><div><p class="eyebrow">PLATFORM ADMINISTRATION</p><h2>Verification queue</h2><p class="muted">Review student identity evidence. Private documents should only be opened by authorized admins.</p></div><span class="count-bubble">${state.verifications.length}</span></div>
      ${state.verifications.length ? `<div class="stack-list">${state.verifications.map(row => `
        <article class="review-card">
          <div class="list-card-main"><strong>${esc(row.full_name || 'Trainee account')}</strong><p class="muted small-text">${esc(row.email || row.id)}</p><p class="small-text">Account ${statusPill(row.account_status)}</p>
          ${row.document ? `<p class="small-text">Latest document: ${esc(row.document.document_type)} · ${esc(row.document.status)}</p>` : '<p class="muted small-text">No document submitted yet.</p>'}</div>
          <div class="button-row">
            ${row.document?.status === 'PENDING' ? `<button class="btn btn-outline btn-small" data-action="view-document" data-object-path="${esc(row.document.object_path)}">View ID</button><button class="btn btn-primary btn-small" data-action="review-verification" data-trainee-id="${esc(row.id)}" data-document-id="${esc(row.document.id)}" data-decision="APPROVE">Approve</button><button class="btn btn-danger-quiet btn-small" data-action="review-verification" data-trainee-id="${esc(row.id)}" data-document-id="${esc(row.document.id)}" data-decision="REJECT">Reject</button>` : ''}
          </div>
        </article>`).join('')}</div>` : '<div class="empty-state compact"><strong>No accounts awaiting verification</strong><p>Submitted university-ID documents will appear here.</p></div>'}
      <div class="panel-divider"></div>
      <div class="panel-heading"><div><h3>Booking confirmations</h3><p class="muted">Confirm a booking after the mentor approves the application.</p></div></div>
      ${state.adminApplications.filter(row => row.status === 'MENTOR_APPROVED').length ? `<div class="stack-list">${state.adminApplications.filter(row => row.status === 'MENTOR_APPROVED').map(row => {
        const offering = state.offers.find(item => item.id === row.offering_id);
        return `<article class="review-card"><div class="list-card-main"><strong>${esc(offering?.title || 'Training application')}</strong><p class="muted small-text">Trainee <code>${esc(row.trainee_profile_id)}</code></p><p class="muted small-text">Mentor approval recorded ${esc(fmtDate(row.mentor_decided_at))}</p></div><button class="btn btn-primary btn-small" data-action="confirm-application" data-application-id="${esc(row.id)}">Confirm booking</button></article>`;
      }).join('')}</div>` : '<div class="empty-state compact"><strong>No mentor-approved bookings awaiting confirmation</strong></div>'}
      <div class="panel-divider"></div>
      <div class="panel-heading"><div><h3>Training setup</h3><p class="muted">Configure mentors and training offers. Only a published/assignable specialty template can be offered for booking.</p></div></div>
      ${cat ? renderAdminForms(cat) : '<div class="empty-state compact"><strong>Loading admin catalogue…</strong></div>'}
    </section>`;
}

function renderAdminForms(cat) {
  const mentorIds = new Set((cat.roles || []).filter(row => row.role === 'MENTOR').map(row => row.user_id));
  const eligibleProfiles = (cat.profiles || []).filter(row => !mentorIds.has(row.id));
  const approvedMentors = (cat.mentors || []).filter(row => row.profile_status === 'APPROVED');
  const publishedOfferings = (cat.offerings || []).filter(row => row.status === 'PUBLISHED');
  const publishedVersions = (cat.templateVersions || []).filter(row => row.status === 'PUBLISHED' && row.is_assignable);
  return `
    <div class="admin-tools">
      <form id="admin-mentor-form" class="admin-form">
        <div class="admin-form-heading"><span class="step-number">A</span><div><strong>Register a mentor</strong><p>Choose an existing MENTORO account.</p></div></div>
        <label>Account<select name="profileId" required><option value="">Select an account</option>${eligibleProfiles.map(row => `<option value="${esc(row.id)}">${esc(row.full_name || row.email || row.id)} · ${esc(row.account_status)}</option>`).join('')}</select></label>
        <label>Display name<input name="displayName" maxlength="160" required placeholder="Mentor display name"></label>
        <label>Professional title<input name="professionalTitle" maxlength="200" placeholder="e.g. Consultant General Surgeon"></label>
        <label>Institution<input name="institution" maxlength="200" placeholder="Hospital or university"></label>
        <label>Short bio<textarea name="bio" maxlength="2000" rows="2" placeholder="Professional background"></textarea></label>
        <label class="check-label"><input type="checkbox" name="makePublic"> Make the approved mentor profile public</label>
        <button class="btn btn-outline btn-block" type="submit">Register mentor</button>
      </form>
      <form id="admin-offering-form" class="admin-form">
        <div class="admin-form-heading"><span class="step-number">B</span><div><strong>Create a training offer</strong><p>Drafts stay unavailable to trainees.</p></div></div>
        <label>Mentor<select name="mentorProfileId" required><option value="">Select a mentor</option>${approvedMentors.map(row => `<option value="${esc(row.profile_id)}">${esc(row.display_name || row.profile_id)}${row.is_public ? ' · Public' : ''}</option>`).join('')}</select></label>
        <label>Specialty<select name="specialtyId" required><option value="">Select a specialty</option>${cat.specialties.map(row => `<option value="${esc(row.id)}">${esc(row.name_en)}</option>`).join('')}</select></label>
        <label>Template version<select name="templateVersionId" required><option value="">Select a template version</option>${cat.templateVersions.map(row => {
          const t = cat.templates.find(item => item.id === row.template_id);
          return `<option value="${esc(row.id)}" ${row.status !== 'PUBLISHED' || !row.is_assignable ? 'disabled' : ''}>${esc(t?.title || 'Template')} v${esc(row.version_number)} · ${esc(row.status)}${row.is_assignable ? ' · Assignable' : ''}</option>`;
        }).join('')}</select></label>
        <label>Offer title<input name="title" maxlength="180" required placeholder="e.g. General Surgery Clinical Training"></label>
        <label>Description<textarea name="description" rows="2" maxlength="2500" placeholder="What the training includes"></textarea></label>
        <label>Format<select name="deliveryMode"><option value="IN_PERSON">In person</option><option value="ONLINE">Online</option><option value="HYBRID">Hybrid</option></select></label>
        <label class="check-label"><input type="checkbox" name="publish" ${publishedVersions.length && approvedMentors.some(row => row.is_public) ? '' : 'disabled'}> Publish now (requires an approved, assignable template and public mentor)</label>
        <button class="btn btn-outline btn-block" type="submit" ${approvedMentors.length ? '' : 'disabled'}>Create offer</button>
        ${!publishedVersions.length ? '<p class="field-note">No template version is approved for booking yet. General Surgery v1 remains a draft pending clinical schema review.</p>' : ''}
      </form>
      <form id="admin-slot-form" class="admin-form">
        <div class="admin-form-heading"><span class="step-number">C</span><div><strong>Add a training slot</strong><p>Only published offers can have bookable slots.</p></div></div>
        <label>Published offer<select name="offeringId" required><option value="">Select an offer</option>${publishedOfferings.map(row => `<option value="${esc(row.id)}">${esc(row.title)}</option>`).join('')}</select></label>
        <label>Starts<input name="startsAt" type="datetime-local" required></label>
        <label>Ends<input name="endsAt" type="datetime-local" required></label>
        <label>Capacity<input name="capacity" type="number" min="1" max="1000" value="1" required></label>
        <button class="btn btn-outline btn-block" type="submit" ${publishedOfferings.length ? '' : 'disabled'}>Create slot</button>
      </form>
    </div>`;
}

function renderToast() {
  if (!state.toast) return '';
  return `<div class="toast toast-${esc(state.toast.type)}" role="status"><span>${esc(state.toast.message)}</span><button type="button" aria-label="Dismiss notification" data-action="dismiss-toast">×</button></div>`;
}

function renderDashboard() {
  const name = state.profile?.full_name || state.user?.email?.split('@')[0] || 'there';
  const status = state.profile?.account_status || 'PROFILE_SETUP';
  app.innerHTML = `
    <div class="page-shell">
      ${shellHeader()}
      <main class="dashboard-main">
        <section class="welcome-row"><div><p class="eyebrow">YOUR MENTORO WORKSPACE</p><h1>Hello, ${esc(name)}<span>.</span></h1><p class="lead">Your trainings, mentor feedback, and independent logbooks in one place.</p></div><div class="role-pills">${state.roles.map(role => statusPill(role)).join('')}</div></section>
        ${!state.profile ? `<div class="notice notice-warning"><span class="notice-icon">!</span><div><h2>Profile setup is pending</h2><p>${state.user?.email_confirmed_at ? 'Your account profile is being initialized.' : 'Confirm your email from your inbox, then sign in again to finish setting up your profile.'}</p></div></div>` : ''}
        ${state.profile && status !== 'VERIFIED' ? `
          <section class="verification-panel ${status === 'REJECTED' ? 'verification-rejected' : ''}">
            <div class="verification-copy"><span class="icon-square">${status === 'REJECTED' ? '↻' : '✓'}</span><div><p class="eyebrow">ACCOUNT VERIFICATION</p><h2>${status === 'REJECTED' ? 'Your verification needs attention' : 'Verify your student identity'}</h2><p>${status === 'REJECTED' ? esc(state.profile.verification_reason || 'Please upload a clearer document or contact MENTORO administration.') : 'Upload your university ID or an accepted university document. A MENTORO administrator will review it before you can apply for a training.'}</p>${statusPill(status)}</div></div>
            <form id="verification-form" class="upload-form"><label class="upload-drop"><span class="upload-symbol">↑</span><strong>Choose your university ID</strong><span>PDF, JPG or PNG · up to 5 MB</span><input type="file" name="document" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" required></label><button class="btn btn-primary" type="submit" ${state.busy ? 'disabled' : ''}>Upload for review</button></form>
          </section>` : ''}
        <section class="metrics-row">
          <article class="metric-card"><span class="metric-label">Training applications</span><strong>${state.applications.length}</strong><span class="metric-foot">Across all specialties</span></article>
          <article class="metric-card"><span class="metric-label">Independent logbooks</span><strong>${state.enrollments.filter(e => e.logbookInstance).length}</strong><span class="metric-foot">One per confirmed training</span></article>
          <article class="metric-card"><span class="metric-label">Account status</span><strong class="metric-status">${esc(String(status).replaceAll('_',' '))}</strong><span class="metric-foot">${isVerified() ? 'Ready to apply' : 'Verification required for applications'}</span></article>
        </section>
        <section class="content-section">
          <div class="section-heading"><div><p class="eyebrow">FIND YOUR NEXT EXPERIENCE</p><h2>Available clinical training</h2><p class="muted">Every confirmed booking will receive its own logbook instance.</p></div><button class="btn btn-quiet btn-small" data-action="refresh">Refresh</button></div>
          ${renderOfferList()}
        </section>
        <section class="content-section">
          <div class="section-heading"><div><p class="eyebrow">APPLICATION TRACKER</p><h2>Your applications</h2></div></div>
          ${renderApplications()}
        </section>
        <section class="content-section">
          <div class="section-heading"><div><p class="eyebrow">YOUR HISTORY</p><h2>My training logbooks</h2><p class="muted">Multiple simultaneous trainings are supported. Historical records stay with their original enrollment.</p></div></div>
          ${renderEnrollments()}
          ${renderEntries()}
        </section>
        ${renderMentorPanel()}
        ${renderAdminPanel()}
      </main>
      ${renderToast()}
      <footer class="footer"><span>mentoro</span><span>Clinical exposure is not the same as competency certification.</span></footer>
    </div>`;
}

function render() {
  if (!configured) return renderConfigError();
  if (!state.session) return renderAuth();
  return renderDashboard();
}

async function loadPublicOffers() {
  try {
    const data = await publicGet('/api/trainings/offers');
    state.offers = data.offerings || [];
  } catch (error) {
    state.offers = [];
  }
}

async function loadDashboard() {
  const revision = ++state.loadRevision;
  await loadPublicOffers();
  if (!state.session) { render(); return; }

  try {
    let me = await api('/api/auth/me');
    state.user = me.user;
    state.profile = me.profile;
    state.roles = me.roles || [];

    if (!state.profile && me.user?.emailVerified) {
      try {
        await api('/api/auth/provision', {
          method: 'POST',
          body: JSON.stringify({ fullName: me.user.email?.split('@')[0] || null })
        });
        me = await api('/api/auth/me');
        state.profile = me.profile;
        state.roles = me.roles || [];
      } catch (error) {
        // A failed provision stays visible as a profile setup state; never imply it succeeded.
      }
    }
  } catch (error) {
    state.toast = { message: 'Session could not be verified. Sign out and sign in again.', type: 'warning' };
    render();
    return;
  }
  if (revision !== state.loadRevision) return;

  const tasks = [
    api('/api/applications').then(data => { state.applications = data.applications || []; }),
    api('/api/trainee/enrollments').then(data => { state.enrollments = data.enrollments || []; })
  ];
  if (isMentor()) {
    tasks.push(api('/api/mentor/applications').then(data => { state.mentorApplications = data.applications || []; }));
    tasks.push(api('/api/mentor/entries').then(data => { state.mentorEntries = data.entries || []; }).catch(() => { state.mentorEntries = []; }));
  } else {
    state.mentorApplications = [];
    state.mentorEntries = [];
  }
  if (isAdmin()) {
    tasks.push(api('/api/admin/verifications').then(data => { state.verifications = data.verifications || []; }));
    tasks.push(api('/api/admin/applications').then(data => { state.adminApplications = data.applications || []; }));
    tasks.push(api('/api/admin/catalog').then(data => { state.catalog = data; }));
  } else {
    state.verifications = [];
    state.adminApplications = [];
    state.catalog = null;
  }
  const settled = await Promise.allSettled(tasks);
  const failures = settled.filter(result => result.status === 'rejected');
  if (failures.length) state.toast = { message: 'Some dashboard information could not be loaded. Use Refresh to try again.', type: 'warning' };

  if (state.selectedInstanceId) await loadEntries(state.selectedInstanceId, false);
  if (revision === state.loadRevision) render();
}

async function loadEntries(instanceId, shouldRender = true) {
  state.selectedInstanceId = instanceId;
  try {
    const data = await api(`/api/logbook/entries?instanceId=${encodeURIComponent(instanceId)}`);
    state.entries = data.entries || [];
    state.toast = null;
  } catch (error) {
    state.entries = [];
    state.toast = { message: 'That logbook could not be opened for this account.', type: 'warning' };
  }
  if (shouldRender) render();
}

function setSession(session) {
  state.session = session;
  state.user = session?.user || null;
  if (!session) {
    state.profile = null; state.roles = []; state.applications = [];
    state.enrollments = []; state.entries = []; state.selectedInstanceId = null;
    state.mentorApplications = []; state.mentorEntries = []; state.verifications = [];
    state.adminApplications = []; state.catalog = null;
  }
}

if (supabase) {
  supabase.auth.onAuthStateChange((_event, session) => {
    setSession(session);
    void loadDashboard();
  });
  supabase.auth.getSession().then(({ data }) => {
    setSession(data?.session || null);
    return loadDashboard();
  }).catch(() => render());
} else {
  render();
}

app.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;

  try {
    if (action === 'toggle-auth') {
      state.mode = state.mode === 'login' ? 'signup' : 'login'; state.toast = null; render(); return;
    }
    if (action === 'dismiss-toast') { state.toast = null; render(); return; }
    if (action === 'sign-out') {
      await supabase.auth.signOut();
      setSession(null); state.mode = 'login'; state.toast = null; render(); return;
    }
    if (action === 'refresh') {
      state.toast = null; await loadDashboard(); return;
    }
    if (action === 'apply') {
      if (!isVerified()) return notify('Your MENTORO account must be verified before you can apply.', 'warning');
      const offeringId = button.dataset.offeringId, slotId = button.dataset.slotId;
      if (!window.confirm('Submit an application for this training slot?')) return;
      await api('/api/applications', { method: 'POST', body: JSON.stringify({ offeringId, slotId }) });
      notify('Application submitted. It is now waiting for mentor review.', 'success');
      await loadDashboard(); return;
    }
    if (action === 'open-logbook') {
      await loadEntries(button.dataset.instanceId); return;
    }
    if (action === 'close-logbook') {
      state.selectedInstanceId = null; state.entries = []; render(); return;
    }
    if (action === 'submit-entry') {
      if (!window.confirm('Submit this draft for mentor review?')) return;
      await api('/api/logbook/entries/submit', { method: 'POST', body: JSON.stringify({ entryId: button.dataset.entryId }) });
      notify('Entry submitted for review.', 'success');
      await loadDashboard(); return;
    }
    if (action === 'review-application') {
      const decision = button.dataset.decision;
      const reason = decision === 'REJECT' ? window.prompt('Reason for declining (optional):') : null;
      if (decision === 'REJECT' && reason === null) return;
      if (!window.confirm(`${decision === 'APPROVE' ? 'Approve' : 'Decline'} this application?`)) return;
      await api('/api/mentor/applications/review', {
        method: 'POST',
        body: JSON.stringify({ applicationId: button.dataset.applicationId, decision, reason })
      });
      notify(decision === 'APPROVE' ? 'Application approved; it is awaiting admin confirmation.' : 'Application declined.', 'success');
      await loadDashboard(); return;
    }
    if (action === 'review-entry') {
      const entryId = button.dataset.entryId;
      const decision = document.querySelector(`#review-decision-${CSS.escape(entryId)}`)?.value || 'VERIFIED';
      const feedback = document.querySelector(`#review-feedback-${CSS.escape(entryId)}`)?.value || '';
      await api('/api/mentor/entries/review', { method: 'POST', body: JSON.stringify({ entryId, decision, feedback }) });
      notify('Mentor review recorded.', 'success');
      await loadDashboard(); return;
    }
    if (action === 'review-verification') {
      const decision = button.dataset.decision;
      const reason = decision === 'REJECT' ? window.prompt('Tell the trainee what needs to be corrected:') : null;
      if (decision === 'REJECT' && !reason?.trim()) return notify('A reason is required when rejecting verification.', 'warning');
      if (!window.confirm(`${decision === 'APPROVE' ? 'Verify' : 'Reject'} this trainee account?`)) return;
      await api('/api/admin/verifications/review', {
        method: 'POST',
        body: JSON.stringify({
          traineeProfileId: button.dataset.traineeId,
          documentId: button.dataset.documentId,
          decision,
          reason
        })
      });
      notify(decision === 'APPROVE' ? 'Trainee account verified.' : 'Verification returned for correction.', 'success');
      await loadDashboard(); return;
    }
    if (action === 'confirm-application') {
      if (!window.confirm('Confirm this booking and create its independent logbook?')) return;
      await api('/api/admin/applications/confirm', {
        method: 'POST', body: JSON.stringify({ applicationId: button.dataset.applicationId })
      });
      notify('Booking confirmed. A new logbook instance was created for this enrollment.', 'success');
      await loadDashboard(); return;
    }
    if (action === 'view-document') {
      const result = await supabase.storage.from('trainee-verification').createSignedUrl(button.dataset.objectPath, 60);
      if (result.error || !result.data?.signedUrl) throw new Error('The private document could not be opened for this admin session.');
      window.open(result.data.signedUrl, '_blank', 'noopener,noreferrer'); return;
    }
  } catch (error) {
    notify(error.message || 'The action could not be completed.', 'error');
  }
});

app.addEventListener('submit', async event => {
  const form = event.target;
  event.preventDefault();
  if (!(form instanceof HTMLFormElement)) return;
  state.busy = true;

  try {
    if (form.id === 'auth-form') {
      const values = Object.fromEntries(new FormData(form).entries());
      const email = String(values.email || '').trim().toLowerCase();
      if (state.mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email, password: String(values.password || ''),
          options: { data: { full_name: String(values.fullName || '').trim() } }
        });
        if (error) throw error;
        if (!data.session) {
          notify('Account created. Check your email for a confirmation link, then sign in.', 'success');
          state.mode = 'login'; render(); return;
        }
        setSession(data.session);
        try {
          await api('/api/auth/provision', { method: 'POST', body: JSON.stringify({ fullName: values.fullName }) });
          notify('Account created. Your university identity must now be verified by MENTORO administration.', 'success');
        } catch (error) {
          notify(error.message || 'Sign-up worked, but profile setup needs another attempt after email confirmation.', 'warning');
        }
        await loadDashboard(); return;
      }

      const { data, error } = await supabase.auth.signInWithPassword({ email, password: String(values.password || '') });
      if (error) throw error;
      setSession(data.session);
      state.toast = null;
      await loadDashboard(); return;
    }

    if (form.id === 'verification-form') {
      if (!state.session || !state.user) throw new Error('Sign in before uploading verification documents.');
      const file = form.querySelector('input[name="document"]')?.files?.[0];
      if (!file) throw new Error('Choose a file first.');
      if (file.size > 5 * 1024 * 1024) throw new Error('The document must be no larger than 5 MB.');
      const valid = ['application/pdf', 'image/jpeg', 'image/png'].includes(file.type);
      if (!valid) throw new Error('Only PDF, JPG, and PNG files are accepted.');
      const safeName = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(-100) || 'university-id';
      const path = `${state.user.id}/${Date.now()}-${safeName}`;
      const uploaded = await supabase.storage.from('trainee-verification').upload(path, file, {
        cacheControl: '60', upsert: false, contentType: file.type
      });
      if (uploaded.error) throw uploaded.error;
      await api('/api/profile/verification-document', {
        method: 'POST',
        body: JSON.stringify({ objectPath: uploaded.data.path, documentType: 'UNIVERSITY_ID' })
      });
      notify('Document uploaded to private storage and submitted for review.', 'success');
      await loadDashboard(); return;
    }

    if (form.id === 'entry-form') {
      if (!state.selectedInstanceId) throw new Error('Open a logbook before saving an entry.');
      const values = Object.fromEntries(new FormData(form).entries());
      await api('/api/logbook/entries', {
        method: 'POST',
        body: JSON.stringify({
          instanceId: state.selectedInstanceId,
          entryType: values.entryType,
          title: values.title,
          entryDate: values.entryDate,
          payload: { notes: values.notes || '' }
        })
      });
      notify('Draft saved to this training’s logbook.', 'success');
      await loadDashboard(); return;
    }

    if (form.id === 'admin-mentor-form') {
      const values = Object.fromEntries(new FormData(form).entries());
      await api('/api/admin/mentors', {
        method: 'POST',
        body: JSON.stringify({
          profileId: values.profileId, displayName: values.displayName,
          professionalTitle: values.professionalTitle, institution: values.institution,
          bio: values.bio, makePublic: values.makePublic === 'on'
        })
      });
      notify('Mentor profile registered.', 'success'); await loadDashboard(); return;
    }

    if (form.id === 'admin-offering-form') {
      const values = Object.fromEntries(new FormData(form).entries());
      await api('/api/admin/offerings', {
        method: 'POST',
        body: JSON.stringify({
          mentorProfileId: values.mentorProfileId, specialtyId: values.specialtyId,
          templateVersionId: values.templateVersionId, title: values.title,
          description: values.description, deliveryMode: values.deliveryMode,
          publish: values.publish === 'on'
        })
      });
      notify('Training offer created.', 'success'); await loadDashboard(); return;
    }

    if (form.id === 'admin-slot-form') {
      const values = Object.fromEntries(new FormData(form).entries());
      await api('/api/admin/slots', {
        method: 'POST',
        body: JSON.stringify({
          offeringId: values.offeringId,
          startsAt: new Date(values.startsAt).toISOString(),
          endsAt: new Date(values.endsAt).toISOString(),
          capacity: Number(values.capacity)
        })
      });
      notify('Training slot created.', 'success'); await loadDashboard(); return;
    }
  } catch (error) {
    notify(error.message || 'The action could not be completed.', 'error');
  } finally {
    state.busy = false;
  }
});

