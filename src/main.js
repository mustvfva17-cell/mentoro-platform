import './style.css';
import { renderAdminWorkspace } from './admin-workspace.js';
import { LOGBOOK_ENTRY_TYPES, collectTemplatePayload, getTemplateFields, renderPayloadSummary, renderTemplateFields } from './logbook-schema.js';
import { createClient } from '@supabase/supabase-js';

const app = document.querySelector('#app');
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;
const REGISTERED_HTML_LOGBOOK_PATHS = new Set(['/logbooks/medical-oncology/index.html', '/logbooks/general-surgery/index.html']);

const htmlLogbookWindows = new Map();
const htmlLogbookSync = new Map();
function openHTMLLogbook(instanceId, options = {}) {
  const readOnly = options.readOnly === true;
  const htmlPath = options.htmlPath || '/logbooks/medical-oncology/index.html';
  if (!supabase || !/^[0-9a-f-]{36}$/i.test(instanceId || '') || !REGISTERED_HTML_LOGBOOK_PATHS.has(htmlPath)) {
    message('This logbook is not available for this training.', 'error'); return;
  }
  const existing = htmlLogbookWindows.get(instanceId);
  if (existing && !existing.closed) {
    const sync = htmlLogbookSync.get(instanceId);
    if (readOnly && sync && !sync.readOnly) {
      sync.readOnly = true;
      if (sync.timer) clearTimeout(sync.timer);
      sync.timer = null;
      sync.state = null;
      postHTMLLogbookMessage(instanceId, { type: 'MENTORO_LOGBOOK_SET_READ_ONLY' });
      void reloadExistingHTMLLogbookReadOnly(instanceId);
    }
    existing.focus();
    return;
  }
  const query = new URLSearchParams({ instance: instanceId });
  if (readOnly) query.set('readonly', '1');
  const child = window.open(htmlPath + '?' + query.toString(), '_blank');
  if (!child) { message('Your browser blocked the logbook window. Allow pop-ups for this site and try again.', 'error'); return; }
  htmlLogbookWindows.set(instanceId, child);
  htmlLogbookSync.set(instanceId, { revision: null, timer: null, saving: false, state: null, readOnly, cloudStateLoaded: false });
}
function postHTMLLogbookMessage(instanceId, payload) {
  const child = htmlLogbookWindows.get(instanceId);
  if (child && !child.closed) child.postMessage({ ...payload, instanceId }, window.location.origin);
}
async function reloadExistingHTMLLogbookReadOnly(instanceId) {
  const sync = htmlLogbookSync.get(instanceId);
  if (!sync) return;
  try {
    const { data, error } = await supabase.rpc('get_my_logbook_html_state', { p_instance_id: instanceId });
    if (error) throw error;
    sync.revision = Number(data?.revision ?? 0);
    sync.state = data?.state && typeof data.state === 'object' ? data.state : null;
    sync.cloudStateLoaded = true;
    postHTMLLogbookMessage(instanceId, {
      type: 'MENTORO_LOGBOOK_LOAD_STATE',
      state: sync.state,
      revision: sync.revision,
      hasCloudState: sync.revision > 0,
      readOnly: true
    });
    const { data: reviews, error: reviewsError } = await supabase.rpc('get_my_logbook_html_item_reviews', { p_instance_id: instanceId });
    postHTMLLogbookMessage(instanceId, {
      type: 'MENTORO_LOGBOOK_LOAD_REVIEWS',
      reviews: Array.isArray(reviews) ? reviews : [],
      error: reviewsError?.message || null
    });
  } catch (error) {
    postHTMLLogbookMessage(instanceId, {
      type: 'MENTORO_LOGBOOK_LOAD_ERROR',
      error: error?.message || 'Could not reload this closed training logbook.'
    });
  }
}
async function flushHTMLLogbookState(instanceId) {
  const sync = htmlLogbookSync.get(instanceId);
  if (!sync || !sync.cloudStateLoaded || sync.saving || !sync.state || !Number.isInteger(sync.revision)) return;
  sync.saving = true;
  const stateToSave = sync.state;
  try {
    const { data, error } = await supabase.rpc('save_my_logbook_html_state', { p_instance_id: instanceId, p_state: stateToSave, p_expected_revision: sync.revision });
    if (error) throw error;
    sync.revision = Number(data);
    postHTMLLogbookMessage(instanceId, { type: 'MENTORO_LOGBOOK_SAVE_RESULT', ok: true, revision: sync.revision });
    if (sync.state !== stateToSave) { clearTimeout(sync.timer); sync.timer = setTimeout(() => flushHTMLLogbookState(instanceId), 250); }
  } catch (error) {
    const detail = error?.message || 'Cloud save failed.';
    postHTMLLogbookMessage(instanceId, { type: 'MENTORO_LOGBOOK_SAVE_RESULT', ok: false, error: String(detail).includes('LOGBOOK_STATE_CONFLICT') ? 'This logbook changed in another tab. Close this tab and reopen it to load the latest saved version.' : detail });
  } finally { sync.saving = false; }
}
window.addEventListener('message', async (event) => {
  if (event.origin !== window.location.origin || !event.data || typeof event.data !== 'object') return;
  const { type, instanceId } = event.data;
  const child = htmlLogbookWindows.get(instanceId);
  if (!child || child.closed || event.source !== child || !/^[0-9a-f-]{36}$/i.test(instanceId || '')) return;
  if (type === 'MENTORO_LOGBOOK_READY') {
    try {
      const { data, error } = await supabase.rpc('get_my_logbook_html_state', { p_instance_id: instanceId });
      if (error) throw error;
      const sync = htmlLogbookSync.get(instanceId);
      if (!sync) return;
      sync.revision = Number(data?.revision ?? 0);
      sync.cloudStateLoaded = true;
      postHTMLLogbookMessage(instanceId, { type: 'MENTORO_LOGBOOK_LOAD_STATE', state: data?.state && typeof data.state === 'object' ? data.state : null, revision: sync.revision, hasCloudState: sync.revision > 0, readOnly: sync.readOnly === true });
      const { data: reviews, error: reviewsError } = await supabase.rpc('get_my_logbook_html_item_reviews', { p_instance_id: instanceId });
      postHTMLLogbookMessage(instanceId, {
        type: 'MENTORO_LOGBOOK_LOAD_REVIEWS',
        reviews: Array.isArray(reviews) ? reviews : [],
        error: reviewsError?.message || null
      });
    } catch (error) {
      postHTMLLogbookMessage(instanceId, { type: 'MENTORO_LOGBOOK_LOAD_ERROR', error: error?.message || 'Could not load this training logbook.' });
    }
    return;
  }
  if (type === 'MENTORO_LOGBOOK_MENTOR_REVIEW') {
    const sync = htmlLogbookSync.get(instanceId);
    if (!sync || !sync.readOnly) {
      postHTMLLogbookMessage(instanceId, {
        type: 'MENTORO_LOGBOOK_MENTOR_REVIEW_RESULT',
        ok: false,
        itemId: event.data.itemId,
        itemType: event.data.itemType,
        error: 'Mentor review actions are available only in the assigned read-only review view.'
      });
      return;
    }
    try {
      const { data: review, error } = await supabase.rpc('mentor_review_html_logbook_item', {
        p_instance_id: instanceId,
        p_item_id: event.data.itemId,
        p_item_type: event.data.itemType,
        p_decision: event.data.decision,
        p_feedback: event.data.feedback || null
      });
      postHTMLLogbookMessage(instanceId, {
        type: 'MENTORO_LOGBOOK_MENTOR_REVIEW_RESULT',
        ok: !error,
        review: error ? null : review,
        itemId: event.data.itemId,
        itemType: event.data.itemType,
        error: error?.message || null
      });
    } catch (error) {
      postHTMLLogbookMessage(instanceId, {
        type: 'MENTORO_LOGBOOK_MENTOR_REVIEW_RESULT',
        ok: false,
        review: null,
        itemId: event.data.itemId,
        itemType: event.data.itemType,
        error: error?.message || 'Could not save the mentor review. Check your connection and try again.'
      });
    }
    return;
  }

  if (type === 'MENTORO_LOGBOOK_STATE_CHANGED' && event.data.state && typeof event.data.state === 'object') {
    const sync = htmlLogbookSync.get(instanceId);
    if (!sync) return;
    if (!sync.cloudStateLoaded) return;
    if (sync.readOnly) {
      postHTMLLogbookMessage(instanceId, { type: 'MENTORO_LOGBOOK_SAVE_RESULT', ok: false, error: 'This is a read-only mentor review. Changes are not saved.' });
      return;
    }
    sync.state = event.data.state;
    clearTimeout(sync.timer);
    sync.timer = setTimeout(() => flushHTMLLogbookState(instanceId), event.data.flushNow === true ? 0 : 700);
  }
});


const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const dateTime = (value) => value ? new Date(value).toLocaleString(undefined, {
  dateStyle: 'medium', timeStyle: 'short'
}) : 'Date to be announced';
const localDateISO = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const message = (text, kind = 'info') => {
  const node = document.querySelector('#notice');
  if (!node) return;
  node.className = `notice notice--${kind}`;
  node.textContent = text;
  node.hidden = !text;
};
const setBusy = (button, busy, label = 'Please wait…') => {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.textContent = label;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalText || button.textContent;
  }
};
async function provisionCurrentTrainee(user) {
  const { error: provisionError } = await supabase.rpc('provision_current_trainee', {
    p_full_name: user.user_metadata?.full_name || ''
  });
  if (provisionError) throw provisionError;
}

async function resolveWorkspaceRole(user) {
  const { data: existingProfile, error: profileError } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError) throw profileError;

  // User metadata may defer trainee provisioning, but never grants a workspace role.
  // Dedicated Mentor identities must be registered separately by an active administrator.
  if (!existingProfile) {
    if (user.user_metadata?.mentoro_account_intent === 'MENTOR') {
      await supabase.auth.signOut();
      renderAuth();
      message(
        'This account is reserved for Mentor access. Ask a platform administrator to register it before signing in again. This selection does not grant Mentor permissions.',
        'info'
      );
      return null;
    }
    await provisionCurrentTrainee(user);
    return 'TRAINEE';
  }

  const { data: activeRoles, error: rolesError } = await supabase
    .from('profile_roles')
    .select('role')
    .eq('user_id', user.id)
    .is('revoked_at', null);
  if (rolesError) throw rolesError;

  const roles = new Set((activeRoles || []).map((item) => item.role));
  // Route to the most privileged assigned workspace first; never add a role during routing.
  if (roles.has('SUPER_ADMIN') || roles.has('ADMIN')) return 'ADMIN';
  if (roles.has('MENTOR')) return 'MENTOR';
  if (roles.has('TRAINEE')) {
    await provisionCurrentTrainee(user);
    return 'TRAINEE';
  }

  await supabase.auth.signOut();
  renderAuth();
  message('This account has no active MENTORO workspace role. Ask a platform administrator to review the account.', 'error');
  return null;
}

async function renderWorkspace(user, role) {
  if (role === 'TRAINEE') return renderDashboard(user);
  if (role === 'MENTOR') return renderMentorDashboard(user);
  return renderAdminWorkspace({ user, supabase, shell, esc, dateTime, setBusy, message, errorText });
}

const errorText = (error) => {
  const known = {
    invalid_credentials: 'Email or password is incorrect.',
    email_not_confirmed: 'Please confirm your email using the link we sent you.',
    user_already_exists: 'An account already exists with this email. Try signing in.',
    auth_configuration_missing: 'The app is not connected to Supabase yet. Add the VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY environment variables to the Preview deployment.'
  };
  return known[error?.code] || error?.message || 'Something went wrong. Please try again.';
};

function shell(content, user = null) {
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <a class="brand" href="/" aria-label="MENTORO home">
          <span class="brand-mark" aria-hidden="true"><i></i><i></i></span>
          <span class="brand-word">mentoro<span>o</span></span>
        </a>
        <div class="topbar-right">
          <span class="environment-pill">Clinical mentorship</span>
          ${user ? '<button class="button button--quiet button--small" id="sign-out">Sign out</button>' : ''}
        </div>
      </header>
      <div id="notice" class="notice" role="status" aria-live="polite" hidden></div>
      ${content}
      <footer class="footer"><span>mentoro</span><span>Structured clinical learning, one training at a time.</span></footer>
    </div>`;
  document.querySelector('#sign-out')?.addEventListener('click', async () => {
    await supabase.auth.signOut();
    renderAuth();
  });
}

function renderAuth() {
  shell(`
    <main class="auth-layout">
      <section class="hero">
        <p class="eyebrow">MEDICAL TRAINING, WITH DIRECTION</p>
        <h1>Build clinical confidence.<br><span>With a mentor beside you.</span></h1>
        <p class="hero-copy">A single home for your training applications, verified clinical exposure, and a separate logbook for every confirmed training.</p>
        <div class="value-list">
          <div><span class="value-icon">01</span><div><strong>Real clinical mentorship</strong><p>Find structured training with experienced physicians.</p></div></div>
          <div><span class="value-icon">02</span><div><strong>Your own learning record</strong><p>Every confirmed training gets its own independent logbook.</p></div></div>
          <div><span class="value-icon">03</span><div><strong>Verified trainee access</strong><p>Your university ID is reviewed before applying for training.</p></div></div>
        </div>
      </section>
      <section class="auth-card">
        <div class="card-heading"><p class="eyebrow">GET STARTED</p><h2>Welcome to MENTORO</h2><p>Create a trainee account or prepare a separate account for administrator-assigned Mentor access.</p></div>
        <div class="tab-list" role="tablist" aria-label="Account access">
          <button class="tab is-active" type="button" data-auth-tab="signin" role="tab" aria-selected="true">Sign in</button>
          <button class="tab" type="button" data-auth-tab="signup" role="tab" aria-selected="false">Create account</button>
        </div>
        <form id="auth-form" class="form-stack">
          <div id="name-field" class="field" hidden><label for="full-name">Full name</label><input id="full-name" name="fullName" autocomplete="name" placeholder="Your full name" minlength="2"></div>
          <div id="mentor-intent-field" class="field" hidden><label class="checkbox-field"><input id="mentor-account-intent" name="mentorAccountIntent" type="checkbox" value="yes"> This is a dedicated Mentor account</label><small>Select this only for a separate account that a platform administrator will register. This choice does not grant Mentor access.</small></div>
          <div class="field"><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required></div>
          <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" minlength="8" placeholder="At least 8 characters" required></div>
          <p class="form-hint" id="auth-hint">Use your registered email to continue.</p>
          <button class="button button--primary button--full" type="submit" id="auth-submit">Sign in</button>
        </form>
        <p class="privacy-note">Your verification documents stay in private storage and are visible only to authorized reviewers.</p>
      </section>
    </main>`);

  let mode = 'signin';
  const form = document.querySelector('#auth-form');
  const nameField = document.querySelector('#name-field');
  const mentorIntentField = document.querySelector('#mentor-intent-field');
  const mentorIntentCheckbox = document.querySelector('#mentor-account-intent');
  const password = document.querySelector('#password');
  const submit = document.querySelector('#auth-submit');
  document.querySelectorAll('[data-auth-tab]').forEach((tab) => tab.addEventListener('click', () => {
    mode = tab.dataset.authTab;
    document.querySelectorAll('[data-auth-tab]').forEach((item) => {
      const active = item === tab;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-selected', String(active));
    });
    nameField.hidden = mode !== 'signup';
    mentorIntentField.hidden = mode !== 'signup';
    document.querySelector('#full-name').required = mode === 'signup';
    password.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    document.querySelector('#auth-hint').textContent = mode === 'signup'
      ? (mentorIntentCheckbox.checked
        ? 'Confirm your email, then wait for the administrator to register this dedicated Mentor account before signing in.'
        : 'Confirm your email before signing in to create your trainee profile.')
      : 'Use your registered email to continue.';
    submit.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
    message('');
  }));

  mentorIntentCheckbox.addEventListener('change', () => {
    if (mode !== 'signup') return;
    document.querySelector('#auth-hint').textContent = mentorIntentCheckbox.checked
      ? 'Confirm your email, then wait for the administrator to register this dedicated Mentor account before signing in.'
      : 'Confirm your email before signing in to create your trainee profile.';
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!supabase) {
      message('Supabase is not configured for this deployment. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in the Vercel Preview environment.', 'error');
      return;
    }
    const data = new FormData(form);
    const email = String(data.get('email')).trim().toLowerCase();
    const pass = String(data.get('password'));
    setBusy(submit, true, mode === 'signup' ? 'Creating account…' : 'Signing in…');
    try {
      if (mode === 'signup') {
        const fullName = String(data.get('fullName')).trim();
        const isDedicatedMentor = data.get('mentorAccountIntent') === 'yes';
        const userMetadata = { full_name: fullName };
        if (isDedicatedMentor) userMetadata.mentoro_account_intent = 'MENTOR';
        const { data: result, error } = await supabase.auth.signUp({
          email, password: pass,
          options: { data: userMetadata, emailRedirectTo: window.location.origin }
        });
        if (error) throw error;
        if (result.session) {
          const workspace = await resolveWorkspaceRole(result.session.user);
          if (workspace) await renderWorkspace(result.session.user, workspace);
        } else {
          document.querySelector('[data-auth-tab="signin"]').click();
          message(
            isDedicatedMentor
              ? 'Account created. Confirm the email, then ask the platform administrator to register this dedicated Mentor account before signing in.'
              : 'Account created. Check your email and confirm your address, then return here to sign in.',
            'success'
          );
        }
      } else {
        const { data: result, error } = await supabase.auth.signInWithPassword({ email, password: pass });
        if (error) throw error;
        const workspace = await resolveWorkspaceRole(result.user);
        if (workspace) await renderWorkspace(result.user, workspace);
      }
    } catch (error) {
      message(errorText(error), 'error');
    } finally {
      setBusy(submit, false);
    }
  });
}

async function renderDashboard(user) {
  shell('<main class="dashboard"><section class="loading-panel"><span class="spinner"></span><p>Preparing your training workspace…</p></section></main>', user);
  try {
    const { data: profile, error: profileError } = await supabase
      .from('profiles').select('id,email,full_name,account_status,verification_reason').eq('id', user.id).single();
    if (profileError) throw profileError;
    const [docResult, applicationsResult, enrollmentsResult] = await Promise.all([
      supabase.from('verification_documents').select('id,status,document_type,created_at,review_note').eq('trainee_profile_id', user.id).order('created_at', { ascending: false }).limit(1),
      supabase.from('training_applications').select('id,status,created_at,applicant_note,training_offerings(title,description,delivery_mode,specialties(name_en,name_ar),mentor_profiles(display_name,professional_title)),training_slots(starts_at,ends_at)').eq('trainee_profile_id', user.id).order('created_at', { ascending: false }),
      supabase.from('training_enrollments').select('id,status,starts_at,ends_at,training_offerings(title,mentor_profiles(display_name,professional_title),specialties(name_en,name_ar)),logbook_instances(id,status,template_version_id,logbook_template_versions(id,version_number,status,schema_definition,template_definition),logbook_entries(id,title,entry_date,status,entry_type,payload,created_at,submitted_at,entry_reviews(decision,feedback,reviewed_at)))').eq('trainee_profile_id', user.id).order('created_at', { ascending: false })
    ]);
    if (applicationsResult.error) throw applicationsResult.error;
    if (enrollmentsResult.error) throw enrollmentsResult.error;
    if (docResult.error) throw docResult.error;
    const latestDoc = docResult.data?.[0] || null;
    const accountStatus = profile.account_status || 'PENDING';
    const isVerified = accountStatus === 'VERIFIED';
    const enrollments = enrollmentsResult.data || [];
    const applications = applicationsResult.data || [];
    shell(`
      <main class="dashboard">
        <section class="dashboard-welcome">
          <div><p class="eyebrow">TRAINEE WORKSPACE</p><h1>Welcome back, <span>${esc(profile.full_name || user.email?.split('@')[0] || 'trainee')}</span></h1><p>Manage your verification, training applications, and clinical logbooks from one place.</p></div>
          <span class="status-chip status-chip--${isVerified ? 'good' : 'pending'}">${isVerified ? 'Verified trainee' : 'Verification pending'}</span>
        </section>
        <section class="stats-grid">
          <article class="stat-card"><span>Training applications</span><strong>${applications.length}</strong><small>Across all specialties</small></article>
          <article class="stat-card"><span>My trainings</span><strong>${enrollments.length}</strong><small>Each has its own logbook</small></article>
          <article class="stat-card"><span>Account status</span><strong class="stat-status">${esc(accountStatus.replaceAll('_', ' '))}</strong><small>Reviewed by MENTORO admin</small></article>
        </section>
        ${!isVerified ? verificationPanel(latestDoc, profile) : ''}
        <section class="section-block">
          <div class="section-heading"><div><p class="eyebrow">DISCOVER</p><h2>Available training</h2></div><p>Applications are available after your trainee account is verified.</p></div>
          <div id="offerings" class="cards-grid"><div class="loading-panel"><span class="spinner"></span><p>Loading available training…</p></div></div>
        </section>
        <section class="section-block">
          <div class="section-heading"><div><p class="eyebrow">YOUR ACTIVITY</p><h2>Applications</h2></div><span class="count-badge">${applications.length}</span></div>
          <div class="list-stack">${applications.length ? applications.map(applicationCard).join('') : '<div class="empty-state"><strong>No applications yet</strong><p>When you apply for a training, its status will appear here.</p></div>'}</div>
        </section>
        <section class="section-block">
          <div class="section-heading"><div><p class="eyebrow">CLINICAL LEARNING</p><h2>My logbooks</h2></div><span class="count-badge">${enrollments.length}</span></div>
          <div class="logbook-grid">${enrollments.length ? enrollments.map(logbookCard).join('') : '<div class="empty-state"><strong>Your logbooks will appear here</strong><p>A separate logbook is created automatically when a training booking is confirmed.</p></div>'}</div>
        </section>
      </main>`, user);
    bindVerificationUpload(user, latestDoc);
    await loadOfferings(user, isVerified);
    bindEntryForms(user);
  } catch (error) {
    shell(`<main class="dashboard"><div class="empty-state empty-state--error"><strong>Could not load your workspace</strong><p>${esc(errorText(error))}</p><button class="button button--secondary" id="retry">Try again</button></div></main>`, user);
    document.querySelector('#retry')?.addEventListener('click', () => renderDashboard(user));
  }
}


async function renderMentorDashboard(user) {
  shell('<main class="dashboard"><section class="loading-panel"><span class="spinner"></span><p>Loading your mentor workspace…</p></section></main>', user);
  try {
    const [profileResult, mentorResult, applicationsResult, enrollmentsResult, logbookEntriesResult] = await Promise.all([
      supabase.from('profiles').select('id,full_name,email').eq('id', user.id).maybeSingle(),
      supabase.from('mentor_profiles').select('profile_id,display_name,professional_title,institution').eq('profile_id', user.id).maybeSingle(),
      supabase.rpc('mentor_list_my_applications', { p_limit: 100 }),
      supabase.from('training_enrollments')
        .select('id,status,starts_at,ends_at,training_offerings(title,specialties(name_en)),logbook_instances(id,template_version_id,logbook_template_versions(id,template_definition),logbook_entries(id,status,submitted_at,entry_reviews(decision,reviewed_at)))')
        .order('starts_at', { ascending: true }),
      supabase.rpc('mentor_list_my_logbook_entries', { p_limit: 100 })
    ]);
    if (profileResult.error) throw profileResult.error;
    if (mentorResult.error) throw mentorResult.error;
    if (applicationsResult.error) throw applicationsResult.error;
    if (enrollmentsResult.error) throw enrollmentsResult.error;
    if (logbookEntriesResult.error) throw logbookEntriesResult.error;

    const profile = profileResult.data || {};
    const mentor = mentorResult.data || {};
    const applications = applicationsResult.data || [];
    const enrollments = enrollmentsResult.data || [];
    const pendingLogbookEntries = logbookEntriesResult.data || [];
    const pendingApplications = applications.filter((item) => item.status === 'SUBMITTED');
    const reviewedApplications = applications.filter((item) => item.status !== 'SUBMITTED');
    const activeEnrollments = enrollments.filter((item) => ['CONFIRMED', 'ACTIVE'].includes(item.status));
    const pastEnrollments = enrollments.filter((item) => ['COMPLETED', 'CANCELLED'].includes(item.status));
    const displayName = mentor.display_name || profile.full_name || user.email?.split('@')[0] || 'mentor';

    shell(
      '<main class="dashboard">' +
        '<section class="dashboard-welcome">' +
          '<div><p class="eyebrow">MENTOR WORKSPACE</p><h1>Welcome back, <span>' + esc(displayName) + '</span></h1>' +
          '<p>Review trainee applications and track the clinical trainings assigned to you. Decisions are validated by the database against your mentor identity.</p></div>' +
          '<span class="status-chip status-chip--good">Mentor account</span>' +
        '</section>' +
        '<section class="stats-grid">' +
          '<article class="stat-card"><span>Awaiting your decision</span><strong>' + pendingApplications.length + '</strong><small>Submitted applications</small></article>' +
          '<article class="stat-card"><span>Logbook entries</span><strong>' + pendingLogbookEntries.length + '</strong><small>Awaiting your review</small></article>' +
          '<article class="stat-card"><span>Assigned trainings</span><strong>' + activeEnrollments.length + '</strong><small>Confirmed or active enrollments</small></article>' +
        '</section>' +
        (!mentor.profile_id ? '<section class="empty-state empty-state--error"><strong>Mentor profile setup is incomplete</strong><p>Your sign-in role is recognized, but MENTORO administration needs to finish your mentor profile before offerings can be assigned to you.</p></section>' : '') +
        '<section class="section-block">' +
          '<div class="section-heading"><div><p class="eyebrow">ACTION REQUIRED</p><h2>Applications awaiting your decision</h2></div><span class="count-badge">' + pendingApplications.length + '</span></div>' +
          '<p class="workspace-note">Only applications within your assigned mentor scope are returned by the database.</p>' +
          (pendingApplications.length
            ? '<div class="mentor-queue-grid">' + pendingApplications.map(mentorApplicationCard).join('') + '</div>'
            : '<div class="empty-state"><strong>You are all caught up</strong><p>New applications for your published training offers will appear here.</p></div>') +
        '</section>' +
        '<section class="section-block">' +
          '<div class="section-heading"><div><p class="eyebrow">LOGBOOK REVIEW</p><h2>Submitted entries awaiting review</h2></div><span class="count-badge">' + pendingLogbookEntries.length + '</span></div>' +
          '<p class="workspace-note">Review only applies to entries in trainings assigned to your mentor account. A revision request returns the entry to the trainee for editing.</p>' +
          (pendingLogbookEntries.length
            ? '<div class="mentor-queue-grid">' + pendingLogbookEntries.map(mentorLogbookEntryCard).join('') + '</div>'
            : '<div class="empty-state"><strong>No logbook entries are waiting</strong><p>New submissions for your assigned trainings will appear here.</p></div>') +
        '</section>' +
        '<section class="section-block">' +
          '<div class="section-heading"><div><p class="eyebrow">YOUR TRAINING</p><h2>Assigned clinical trainings</h2></div><span class="count-badge">' + activeEnrollments.length + '</span></div>' +
          (activeEnrollments.length
            ? '<div class="mentor-queue-grid">' + activeEnrollments.map(mentorEnrollmentCard).join('') + '</div>'
            : '<div class="empty-state"><strong>No confirmed trainings yet</strong><p>Confirmed bookings linked to your mentor account will appear here.</p></div>') +
        '</section>' +
        '<section class="section-block">' +
          '<div class="section-heading"><div><p class="eyebrow">TRAINING HISTORY</p><h2>Completed and cancelled trainings</h2></div><span class="count-badge">' + pastEnrollments.length + '</span></div>' +
          (pastEnrollments.length
            ? '<div class="mentor-queue-grid">' + pastEnrollments.map(mentorEnrollmentCard).join('') + '</div>'
            : '<div class="empty-state"><strong>No closed trainings yet</strong><p>Completed or cancelled training records will appear here.</p></div>') +
        '</section>' +
        '<section class="section-block">' +
          '<div class="section-heading"><div><p class="eyebrow">DECISION HISTORY</p><h2>Recently reviewed applications</h2></div><span class="count-badge">' + reviewedApplications.length + '</span></div>' +
          (reviewedApplications.length
            ? '<div class="list-stack">' + reviewedApplications.slice(0, 8).map(mentorApplicationCard).join('') + '</div>'
            : '<div class="empty-state"><strong>No review history yet</strong><p>Once you review an application, the decision will appear here.</p></div>') +
        '</section>' +
      '</main>',
      user
    );
    bindMentorApplicationActions(user);
    bindMentorEntryActions(user);
    bindMentorEnrollmentActions(user);
    document.querySelectorAll('[data-open-html-logbook-readonly]').forEach((button) => {
      button.addEventListener('click', () => openHTMLLogbook(button.dataset.openHtmlLogbookReadonly, { readOnly: true, htmlPath: button.dataset.htmlPath }));
    });
  } catch (error) {
    shell(
      '<main class="dashboard"><div class="empty-state empty-state--error"><strong>Could not load your mentor workspace</strong><p>' +
        esc(errorText(error)) +
        '</p><button class="button button--secondary" id="mentor-retry">Try again</button></div></main>',
      user
    );
    document.querySelector('#mentor-retry')?.addEventListener('click', () => renderMentorDashboard(user));
  }
}

function mentorApplicationCard(item) {
  const isPending = item.status === 'SUBMITTED';
  const deliveryMode = (item.delivery_mode || 'IN_PERSON').replaceAll('_', ' ');
  const education = [
    item.university_name,
    item.faculty_name,
    item.year_of_study ? `Year ${item.year_of_study}` : null
  ].filter(Boolean).join(' · ');
  return '<article class="activity-card mentor-application-card" data-application-card>' +
    '<div class="activity-main">' +
      '<span class="specialty-label">' + esc(item.specialty_name || 'Clinical training') + '</span>' +
      '<h3>' + esc(item.offering_title || 'Training application') + '</h3>' +
      '<p><strong>Applicant:</strong> ' + esc(item.trainee_name || 'Trainee') + '</p>' +
      (education ? '<p class="mentor-trainee-education">' + esc(education) + '</p>' : '') +
      '<p>' + esc(deliveryMode) + ' · ' + esc(dateTime(item.slot_starts_at)) + ' — ' + esc(dateTime(item.slot_ends_at)) + '</p>' +
      '<p class="mentor-applicant-note">' + (item.applicant_note ? '<strong>Applicant note:</strong> ' + esc(item.applicant_note) : 'No note was included with this application.') + '</p>' +
      '<small>Received ' + esc(dateTime(item.created_at)) + '</small>' +
      (isPending
        ? '<div class="mentor-review-actions">' +
            '<input class="mentor-review-reason" type="text" maxlength="500" data-mentor-reason="' + esc(item.application_id) + '" placeholder="Optional feedback for the trainee">' +
            '<div class="mentor-review-buttons">' +
              '<button class="button button--primary button--small" type="button" data-mentor-decision="APPROVE" data-application-id="' + esc(item.application_id) + '">Approve</button>' +
              '<button class="button button--secondary button--small" type="button" data-mentor-decision="REJECT" data-application-id="' + esc(item.application_id) + '">Reject</button>' +
            '</div>' +
          '</div>'
        : '<div class="mentor-review-actions"><span class="status-chip status-chip--neutral">' + esc((item.status || 'REVIEWED').replaceAll('_', ' ')) + '</span>' +
          (item.mentor_decision_reason ? '<p class="mentor-applicant-note"><strong>Decision note:</strong> ' + esc(item.mentor_decision_reason) + '</p>' : '') +
          '</div>') +
    '</div>' +
  '</article>';
}

function mentorLogbookEntryCard(item) {
  const education = [
    item.university_name,
    item.faculty_name,
    item.year_of_study ? `Year ${item.year_of_study}` : null
  ].filter(Boolean).join(' · ');
  const previousReview = item.previous_review_feedback
    ? '<p class="mentor-applicant-note"><strong>Previous feedback:</strong> ' + esc(item.previous_review_feedback) + '</p>'
    : '';
  return '<article class="activity-card mentor-application-card mentor-entry-review-card" data-entry-review-card>' +
    '<div class="activity-main">' +
      '<span class="specialty-label">' + esc(item.specialty_name || 'Clinical training') + '</span>' +
      '<h3>' + esc(item.title || 'Logbook entry') + '</h3>' +
      '<p><strong>Trainee:</strong> ' + esc(item.trainee_name || 'Trainee') + '</p>' +
      (education ? '<p class="mentor-trainee-education">' + esc(education) + '</p>' : '') +
      '<p><strong>Training:</strong> ' + esc(item.training_title || 'Assigned training') + '</p>' +
      '<p>' + esc((item.entry_type || 'LEARNING_ACTIVITY').replaceAll('_', ' ')) + ' · Activity date ' + esc(item.entry_date || 'Not set') + '</p>' +
      '<small>Submitted ' + esc(dateTime(item.submitted_at)) + '</small>' +
      previousReview +
      '<div class="mentor-review-actions">' +
        '<textarea class="mentor-review-reason" rows="3" maxlength="2000" data-entry-feedback="' + esc(item.entry_id) + '" placeholder="Feedback (required for feedback or revision request)"></textarea>' +
        '<div class="mentor-review-buttons">' +
          '<button class="button button--primary button--small" type="button" data-entry-decision="VERIFIED" data-entry-id="' + esc(item.entry_id) + '">Verify entry</button>' +
          '<button class="button button--secondary button--small" type="button" data-entry-decision="FEEDBACK" data-entry-id="' + esc(item.entry_id) + '">Send feedback</button>' +
          '<button class="button button--secondary button--small" type="button" data-entry-decision="NEEDS_REVISION" data-entry-id="' + esc(item.entry_id) + '">Request revision</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
  '</article>';
}

function bindMentorEntryActions(user) {
  document.querySelectorAll('[data-entry-decision]').forEach((button) => button.addEventListener('click', async () => {
    const entryId = button.dataset.entryId;
    const decision = button.dataset.entryDecision;
    const card = button.closest('[data-entry-review-card]');
    const feedback = card?.querySelector('[data-entry-feedback]')?.value?.trim() || '';
    if (!entryId || !['VERIFIED', 'FEEDBACK', 'NEEDS_REVISION'].includes(decision)) return;
    if (['FEEDBACK', 'NEEDS_REVISION'].includes(decision) && !feedback) {
      message('Add feedback before sending a comment or requesting a revision.', 'error');
      return;
    }

    card?.querySelectorAll('button').forEach((item) => { item.disabled = true; });
    setBusy(button, true, 'Saving review…');
    const { error } = await supabase.rpc('mentor_review_my_entry', {
      p_entry_id: entryId,
      p_decision: decision,
      p_feedback: feedback || null
    });
    if (error) {
      message(errorText(error), 'error');
      setBusy(button, false);
      card?.querySelectorAll('button').forEach((item) => { item.disabled = false; });
      return;
    }

    await renderMentorDashboard(user);
    message(
      decision === 'VERIFIED'
        ? 'Logbook entry verified.'
        : decision === 'NEEDS_REVISION'
          ? 'Revision requested. The trainee can edit and resubmit the entry.'
          : 'Feedback saved for the trainee.',
      'success'
    );
  }));
}

function mentorEnrollmentCard(enrollment) {
  const offering = enrollment.training_offerings || {};
  const specialty = offering.specialties || {};
  const instanceRelation = enrollment.logbook_instances;
  const instance = Array.isArray(instanceRelation) ? instanceRelation[0] : instanceRelation;
  const templateRelation = instance?.logbook_template_versions;
  const templateVersion = Array.isArray(templateRelation) ? templateRelation[0] : templateRelation;
  const htmlPath = templateVersion?.template_definition?.html_path;
  const isRegisteredHtml = templateVersion?.template_definition?.renderer === 'HTML' &&
    REGISTERED_HTML_LOGBOOK_PATHS.has(htmlPath);
  const entries = instance?.logbook_entries || [];
  const submittedCount = entries.filter((entry) => {
    if (entry.status !== 'SUBMITTED') return false;
    const latestReview = latestEntryReview(entry);
    return !latestReview || !entry.submitted_at || new Date(entry.submitted_at) > new Date(latestReview.reviewed_at);
  }).length;
  const statusTone = ['CONFIRMED', 'ACTIVE'].includes(enrollment.status) ? 'good' : 'neutral';
  const startsAt = new Date(enrollment.starts_at).getTime();
  const endsAt = new Date(enrollment.ends_at).getTime();
  const now = Date.now();
  let lifecycleActions = '';
  if (enrollment.status === 'CONFIRMED') {
    lifecycleActions = startsAt > now
      ? '<p class="workspace-note">Start action unlocks at the scheduled start time.</p>'
      : endsAt > now
        ? '<button class="button button--primary button--small" type="button" data-enrollment-action="START" data-enrollment-id="' + esc(enrollment.id) + '">Start training</button>'
        : '<p class="workspace-note">The scheduled window has passed. Ask an administrator to review this enrollment.</p>';
  } else if (enrollment.status === 'ACTIVE') {
    lifecycleActions = endsAt <= now
      ? '<button class="button button--primary button--small" type="button" data-enrollment-action="COMPLETE" data-enrollment-id="' + esc(enrollment.id) + '">Complete training</button>'
      : '<p class="workspace-note">Completion is available after the scheduled end time.</p>';
  }
  if (['CONFIRMED', 'ACTIVE'].includes(enrollment.status)) {
    lifecycleActions += '<button class="button button--secondary button--small" type="button" data-enrollment-action="CANCEL" data-enrollment-id="' + esc(enrollment.id) + '">Cancel training</button>';
  }
  const lifecycleMarkup = lifecycleActions
    ? '<div class="mentor-review-actions">' + lifecycleActions + '</div>'
    : '';
  return '<article class="training-card mentor-training-card" data-enrollment-card>' +
    '<div class="training-card-heading"><span class="specialty-label">' + esc(specialty.name_en || 'Clinical training') + '</span>' +
    '<span class="status-chip status-chip--' + statusTone + '">' + esc((enrollment.status || 'CONFIRMED').replaceAll('_', ' ')) + '</span></div>' +
    '<h3>' + esc(offering.title || 'Assigned training') + '</h3>' +
    '<p class="mentor-line">' + esc(dateTime(enrollment.starts_at)) + ' — ' + esc(dateTime(enrollment.ends_at)) + '</p>' +
    '<div class="mentor-entry-stats"><span>' + entries.length + ' native entries</span><span>' + submittedCount + ' awaiting review</span></div>' +
    (isRegisteredHtml && enrollment.status !== 'CANCELLED'
      ? '<p class="workspace-note">Existing HTML logbook is read-only in this mentor view. Item-level reviews are available only while the enrollment remains open or completed.</p>' +
        '<button class="button button--secondary button--small" type="button" data-open-html-logbook-readonly="' + esc(instance.id) + '" data-html-path="' + esc(htmlPath || '') + '">Open HTML logbook · read only</button>'
      : '') +
    lifecycleMarkup +
  '</article>';
}

function bindMentorEnrollmentActions(user) {
  document.querySelectorAll('[data-enrollment-action]').forEach((button) => button.addEventListener('click', async () => {
    const enrollmentId = button.dataset.enrollmentId;
    const action = button.dataset.enrollmentAction;
    if (!enrollmentId || !['START', 'COMPLETE', 'CANCEL'].includes(action)) return;

    let reason = null;
    if (action === 'CANCEL') {
      reason = window.prompt('Enter a cancellation reason (10–1000 characters). This action is recorded in the audit log.');
      if (reason === null) return;
      reason = reason.trim();
      if (reason.length < 10 || reason.length > 1000) {
        message('Enter a cancellation reason of 10–1000 characters.', 'error');
        return;
      }
    } else {
      const label = action === 'START' ? 'start this training' : 'mark this training as completed';
      if (!window.confirm('Are you sure you want to ' + label + '? The change will be recorded in the enrollment audit log.')) return;
    }

    const card = button.closest('[data-enrollment-card]');
    card?.querySelectorAll('button').forEach((item) => { item.disabled = true; });
    setBusy(button, true, action === 'START' ? 'Starting…' : action === 'COMPLETE' ? 'Completing…' : 'Cancelling…');
    const { error } = await supabase.rpc('transition_my_training_enrollment', {
      p_enrollment_id: enrollmentId, p_action: action, p_reason: reason
    });
    if (error) {
      message(errorText(error), 'error');
      setBusy(button, false);
      card?.querySelectorAll('button').forEach((item) => { item.disabled = false; });
      return;
    }

    await renderMentorDashboard(user);
    message(
      action === 'START' ? 'Training started. The enrollment is now active.'
        : action === 'COMPLETE' ? 'Training completed. The logbook is now read-only for the trainee.'
          : 'Training cancelled. The reason and status change were recorded.',
      'success'
    );
  }));
}

function bindMentorApplicationActions(user) {
  document.querySelectorAll('[data-mentor-decision]').forEach((button) => button.addEventListener('click', async () => {
    const applicationId = button.dataset.applicationId;
    const decision = button.dataset.mentorDecision;
    const card = button.closest('[data-application-card]');
    const reason = card?.querySelector('[data-mentor-reason]')?.value?.trim() || '';
    if (!applicationId || !['APPROVE', 'REJECT'].includes(decision)) return;

    card?.querySelectorAll('button').forEach((item) => { item.disabled = true; });
    setBusy(button, true, decision === 'APPROVE' ? 'Approving…' : 'Rejecting…');
    const { error } = await supabase.rpc('mentor_review_my_application', {
      p_application_id: applicationId,
      p_decision: decision,
      p_reason: reason || null
    });
    if (error) {
      message(errorText(error), 'error');
      setBusy(button, false);
      card?.querySelectorAll('button').forEach((item) => { item.disabled = false; });
      return;
    }

    await renderMentorDashboard(user);
    message(decision === 'APPROVE'
      ? 'Application approved. MENTORO administration can now confirm the booking.'
      : 'Application rejected. Your decision has been recorded.', 'success');
  }));
}

function verificationPanel(doc, profile) {
  const status = doc?.status || 'NOT_SUBMITTED';
  const labels = { PENDING: 'Document under review', APPROVED: 'Document approved', REJECTED: 'Document needs attention', SUPERSEDED: 'Replaced by a newer document', NOT_SUBMITTED: 'University ID required' };
  return `
    <section class="verification-panel">
      <div class="verification-copy"><span class="step-number">01</span><div><p class="eyebrow">ACCOUNT VERIFICATION</p><h2>${labels[status] || 'University verification required'}</h2><p>${status === 'PENDING' ? 'Your document has been submitted. You can browse training, but applications unlock after verification.' : esc(profile.verification_reason || doc?.review_note || 'Upload a clear photo or PDF of your university ID. Your document is kept private.')}</p></div></div>
      ${status === 'PENDING' ? '<span class="status-chip status-chip--pending">In review</span>' : `
        <form id="verification-form" class="upload-form">
          <label class="file-drop" for="university-id"><span class="upload-icon">↑</span><strong>Choose university ID</strong><small>JPG, PNG or PDF · max 8 MB</small><input id="university-id" name="document" type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" required></label>
          <button class="button button--primary" type="submit" id="upload-submit">Submit for verification</button>
        </form>`}
    </section>`;
}

function applicationCard(item) {
  const offering = item.training_offerings || {};
  const mentor = offering.mentor_profiles || {};
  const specialty = offering.specialties || {};
  return `<article class="activity-card"><div class="activity-main"><span class="specialty-label">${esc(specialty.name_en || 'Clinical training')}</span><h3>${esc(offering.title || 'Training')}</h3><p>${esc(mentor.display_name || 'Mentor to be confirmed')} · ${esc(mentor.professional_title || '')}</p><small>${dateTime(item.training_slots?.starts_at)}</small></div><span class="status-chip status-chip--neutral">${esc((item.status || 'SUBMITTED').replaceAll('_', ' '))}</span></article>`;
}

function latestEntryReview(entry) {
  return [...(entry.entry_reviews || [])].sort((a, b) =>
    String(b.reviewed_at || '').localeCompare(String(a.reviewed_at || ''))
  )[0] || null;
}

function logbookCard(enrollment) {
  const offering = enrollment.training_offerings || {};
  const mentor = offering.mentor_profiles || {};
  const specialty = offering.specialties || {};
  const instanceRelation = enrollment.logbook_instances;
  // enrollment_id is unique in logbook_instances, so PostgREST may embed this as an object.
  const instance = Array.isArray(instanceRelation) ? instanceRelation[0] : instanceRelation;
  const templateRelation = instance?.logbook_template_versions;
  const templateVersion = Array.isArray(templateRelation) ? templateRelation[0] : templateRelation;
  const htmlPath = templateVersion?.template_definition?.html_path;
  const isRegisteredHtml = templateVersion?.template_definition?.renderer === 'HTML' &&
    REGISTERED_HTML_LOGBOOK_PATHS.has(htmlPath);
  const enrollmentClosed = !['CONFIRMED', 'ACTIVE'].includes(enrollment.status);
  const templateFields = getTemplateFields(templateVersion);
  const entries = [...(instance?.logbook_entries || [])].sort((a, b) =>
    String(b.entry_date || '').localeCompare(String(a.entry_date || '')) ||
    String(b.created_at || '').localeCompare(String(a.created_at || ''))
  );
  const draftCount = entries.filter((entry) => ['DRAFT', 'RETURNED'].includes(entry.status)).length;
  const entryTypeOptions = LOGBOOK_ENTRY_TYPES.map((type) =>
    '<option value="' + esc(type.value) + '"' + (type.value === 'LEARNING_ACTIVITY' ? ' selected' : '') +
    '>' + esc(type.label) + '</option>'
  ).join('');
  return `
    <article class="logbook-card">
      <div class="logbook-card-top"><span class="logbook-symbol">M</span><span class="status-chip status-chip--${enrollment.status === 'ACTIVE' ? 'good' : 'neutral'}">${esc(enrollment.status.replaceAll('_', ' '))}</span></div>
      <span class="specialty-label">${esc(specialty.name_en || 'Clinical training')}</span><h3>${esc(offering.title || 'Training logbook')}</h3>
      <p class="mentor-line">${esc(mentor.display_name || 'Assigned mentor')}</p>
      <div class="logbook-meta"><span>${entries.length} entries</span><span>${draftCount} drafts / revisions</span></div>
      ${instance && isRegisteredHtml
        ? '<button class="button button--primary button--small" type="button" data-open-html-logbook="' + esc(instance.id) + '" data-html-path="' + esc(htmlPath || '') + '" data-read-only="' + (enrollmentClosed ? 'true' : 'false') + '">Open ' + (enrollmentClosed ? 'read-only' : 'interactive') + ' logbook</button><p class="workspace-note">' + (enrollmentClosed ? 'This training is closed. The logbook is read-only; do not enter patient-identifying information.' : 'This uses the original HTML logbook for this training. Cloud changes save to this enrollment only; do not enter patient-identifying information.') + '</p>'
        : ''}
      ${instance && !isRegisteredHtml ? `
        ${enrollmentClosed
          ? '<p class="workspace-note">This training is closed. The logbook is read-only; existing entries and mentor feedback remain available.</p>'
          : `
        <form class="entry-form" data-instance-id="${esc(instance.id)}">
          <label for="entry-title-${esc(instance.id)}">Entry title</label>
          <input id="entry-title-${esc(instance.id)}" name="title" placeholder="Short title for this activity" maxlength="160" required>
          <div class="entry-form-row">
            <label class="template-field"><span>Entry type</span><select name="entryType" required>${entryTypeOptions}</select></label>
            <label class="template-field"><span>Activity date</span><input name="date" type="date" required value="${localDateISO()}"></label>
          </div>
          <p class="workspace-note">Use the fields defined by this training’s assigned logbook template.</p>
          ${renderTemplateFields(templateFields, instance.id)}
          <button class="button button--secondary button--small" type="submit">Save draft</button>
        </form>
        `}
        ${!isRegisteredHtml && entries.length ? `<div class="entry-list">${[...entries].sort((a,b)=>Number(b.status === 'RETURNED')-Number(a.status === 'RETURNED')).slice(0,6).map((entry) => {
          const review = latestEntryReview(entry);
          const displayStatus = entry.status === 'RETURNED' ? 'NEEDS REVISION' : (entry.status === 'SUBMITTED' && review ? review.decision : entry.status);
          return `<div class="entry-row entry-row--detail"><span class="entry-dot entry-dot--${['VERIFIED','APPROVED'].includes(displayStatus) ? 'good' : 'neutral'}"></span><div class="entry-row-copy"><strong>${esc(entry.title)}</strong><small>${esc(entry.entry_type.replaceAll('_', ' '))} · ${esc(entry.entry_date)} · ${esc(displayStatus.replaceAll('_',' '))}</small>${renderPayloadSummary(entry.payload, templateFields)}${review?.feedback ? `<small class="entry-feedback">Mentor feedback: ${esc(review.feedback)}</small>` : ''}</div>${!enrollmentClosed && entry.status === 'DRAFT' ? `<button class="text-button" data-submit-entry="${esc(entry.id)}">Submit</button>` : ''}</div>${!enrollmentClosed && entry.status === 'RETURNED' ? `<form class="entry-edit-form" data-edit-entry="${esc(entry.id)}"><label for="entry-edit-title-${esc(entry.id)}">Revise returned entry</label><input id="entry-edit-title-${esc(entry.id)}" name="title" value="${esc(entry.title)}" maxlength="160" required><p class="workspace-note">Entry type: ${esc(entry.entry_type.replaceAll('_', ' '))}. The type stays fixed while you revise the entry.</p><div class="entry-form-row"><label class="template-field"><span>Activity date</span><input name="date" type="date" aria-label="Revised activity date" value="${esc(entry.entry_date)}" required></label></div>${renderTemplateFields(templateFields, instance.id + '-' + entry.id, entry.payload || {})}<button class="button button--secondary button--small" type="submit">Save &amp; resubmit</button></form>` : ''}`;
        }).join('')}</div>` : (enrollmentClosed ? '<p class="empty-inline">No logbook entries were recorded before this training closed.</p>' : '<p class="empty-inline">Your first entry will appear here.</p>')}
      ` : '<p class="empty-inline">The logbook template is not yet attached to this training.</p>'}
    </article>`;
}

function bindVerificationUpload(user, latestDoc) {
  const form = document.querySelector('#verification-form');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = new FormData(form).get('document');
    if (!(file instanceof File) || !file.size) return;
    const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!allowed.includes(file.type)) return message('Upload a JPG, PNG, or PDF file.', 'error');
    if (file.size > 8 * 1024 * 1024) return message('The file must be 8 MB or smaller.', 'error');
    const button = document.querySelector('#upload-submit');
    setBusy(button, true, 'Uploading securely…');
    try {
      const safeName = file.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g, '-').slice(-100);
      const path = `${user.id}/${Date.now()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from('trainee-verification').upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const { error: recordError } = await supabase.rpc('record_verification_document', { p_object_path: path, p_document_type: 'UNIVERSITY_ID' });
      if (recordError) throw recordError;
      await renderDashboard(user);
      message('University ID submitted securely. Your account will remain pending until an administrator reviews it.', 'success');
    } catch (error) {
      message(errorText(error), 'error');
      setBusy(button, false);
    }
  });
}

async function loadOfferings(user, isVerified) {
  const target = document.querySelector('#offerings');
  if (!target) return;
  const { data, error } = await supabase.from('training_offerings')
    .select('id,title,description,delivery_mode,specialties(name_en,name_ar),mentor_profiles(display_name,professional_title,institution),training_slots(id,starts_at,ends_at,capacity,status)')
    .eq('status', 'PUBLISHED').order('created_at', { ascending: false });
  if (error) {
    target.innerHTML = '<div class="empty-state"><strong>Training listings are temporarily unavailable</strong><p>Check your connection and try loading the listings again.</p><button class="button button--secondary" id="retry-offerings" type="button">Retry loading</button></div>';
    target.querySelector('#retry-offerings')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      setBusy(button, true, 'Loading…');
      await loadOfferings(user, isVerified);
    });
    return;
  }
  const offerings = (data || []).map((offering) => ({
    ...offering,
    openSlots: (offering.training_slots || []).filter((slot) => slot.status === 'OPEN' && new Date(slot.starts_at) > new Date())
  })).filter((offering) => offering.openSlots.length);
  if (!offerings.length) {
    target.innerHTML = '<div class="empty-state"><strong>No open training slots yet</strong><p>Published offerings and future open slots will appear here when MENTORO administration makes them available.</p></div>';
    return;
  }
  target.innerHTML = offerings.map((offering) => {
    const specialty = offering.specialties || {};
    const mentor = offering.mentor_profiles || {};
    return `
      <article class="training-card">
        <div class="training-card-heading"><span class="specialty-label">${esc(specialty.name_en || 'Specialty')}</span><span class="mode-tag">${esc((offering.delivery_mode || 'IN_PERSON').replaceAll('_', ' '))}</span></div>
        <h3>${esc(offering.title)}</h3><p class="mentor-line">${esc(mentor.display_name || 'MENTORO mentor')} · ${esc(mentor.professional_title || '')}</p>
        <p class="training-description">${esc(offering.description || 'Structured clinical training with a dedicated mentor.')}</p>
        <label class="field-label" for="slot-${esc(offering.id)}">Choose an available session</label>
        <select id="slot-${esc(offering.id)}" class="slot-select" data-slot-select="${esc(offering.id)}">
          ${offering.openSlots.map((slot) => `<option value="${esc(slot.id)}">${dateTime(slot.starts_at)} — ${dateTime(slot.ends_at)}</option>`).join('')}
        </select>
        <button class="button button--primary button--full apply-button" data-apply="${esc(offering.id)}" ${isVerified ? '' : 'disabled'}>${isVerified ? 'Apply for training' : 'Verify account to apply'}</button>
      </article>`;
  }).join('');
  target.querySelectorAll('[data-apply]').forEach((button) => button.addEventListener('click', async () => {
    if (!isVerified) return;
    const offeringId = button.dataset.apply;
    const slotId = target.querySelector(`[data-slot-select="${CSS.escape(offeringId)}"]`)?.value;
    if (!slotId) return;
    setBusy(button, true, 'Submitting…');
    const { error: applyError } = await supabase.from('training_applications').insert({
      trainee_profile_id: user.id, offering_id: offeringId, slot_id: slotId, status: 'SUBMITTED'
    });
    if (applyError) {
      message(applyError.code === '23505' ? 'You already have an application for this session.' : errorText(applyError), 'error');
      setBusy(button, false);
      return;
    }
    await renderDashboard(user);
    message('Application submitted. Your mentor will review it, then MENTORO administration confirms the booking.', 'success');
  }));
}

function bindEntryForms(user) {
  document.querySelectorAll('[data-open-html-logbook]').forEach((button) => button.addEventListener('click', () => openHTMLLogbook(button.dataset.openHtmlLogbook, { readOnly: button.dataset.readOnly === 'true', htmlPath: button.dataset.htmlPath })));
  document.querySelectorAll('.entry-form').forEach((form) => form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const button = form.querySelector('button[type="submit"]');
    setBusy(button, true, 'Saving…');
    const title = String(data.get('title') || '').trim();
    const entryDate = String(data.get('date') || '');
    const entryType = String(data.get('entryType') || '');
    const templatePayload = collectTemplatePayload(form);
    if (!form.dataset.instanceId || !title || !entryDate || !LOGBOOK_ENTRY_TYPES.some((type) => type.value === entryType)) {
      message('Complete the title, entry type, and activity date.', 'error');
      setBusy(button, false);
      return;
    }
    if (templatePayload.errors.length) {
      message(templatePayload.errors[0], 'error');
      setBusy(button, false);
      return;
    }
    const { error } = await supabase.from('logbook_entries').insert({
      instance_id: form.dataset.instanceId,
      entry_type: entryType,
      title,
      entry_date: entryDate,
      payload: templatePayload.payload,
      status: 'DRAFT',
      created_by: user.id
    });
    if (error) {
      message(errorText(error), 'error');
      setBusy(button, false);
      return;
    }
    await renderDashboard(user);
    message('Draft saved to this training’s logbook.', 'success');
  }));
  document.querySelectorAll('.entry-edit-form').forEach((form) => form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const entryId = form.dataset.editEntry;
    const button = form.querySelector('button[type="submit"]');
    const title = String(data.get('title') || '').trim();
    const entryDate = String(data.get('date') || '');
    const templatePayload = collectTemplatePayload(form);
    if (!entryId || !title || !entryDate) return;
    if (templatePayload.errors.length) {
      message(templatePayload.errors[0], 'error');
      setBusy(button, false);
      return;
    }
    setBusy(button, true, 'Saving & resubmitting…');

    const { error: editError } = await supabase.from('logbook_entries')
      .update({ title, entry_date: entryDate, payload: templatePayload.payload })
      .eq('id', entryId)
      .eq('status', 'RETURNED');
    if (editError) {
      message(errorText(editError), 'error');
      setBusy(button, false);
      return;
    }

    const { error: submitError } = await supabase.rpc('set_logbook_entry_submitted', {
      p_actor_id: user.id,
      p_entry_id: entryId
    });
    if (submitError) {
      await renderDashboard(user);
      message('Your revision was saved, but could not be resubmitted: ' + errorText(submitError), 'error');
      return;
    }
    await renderDashboard(user);
    message('Revision saved and resubmitted to your mentor.', 'success');
  }));
  document.querySelectorAll('[data-submit-entry]').forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    const { error } = await supabase.rpc('set_logbook_entry_submitted', {
      p_actor_id: user.id,
      p_entry_id: button.dataset.submitEntry
    });
    if (error) {
      message(errorText(error), 'error');
      button.disabled = false;
      return;
    }
    await renderDashboard(user);
    message('Entry submitted to your mentor for review.', 'success');
  }));
}

async function start() {
  if (!supabase) {
    renderAuth();
    message('Preview is not connected to Supabase yet. Authentication will work after the two public Vite environment variables are configured.', 'error');
    return;
  }

  try {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;

    if (session?.user) {
      const workspace = await resolveWorkspaceRole(session.user);
      if (workspace) await renderWorkspace(session.user, workspace);
    } else {
      renderAuth();
    }

    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) renderAuth();
    });
  } catch (error) {
    renderAuth();
    message(errorText(error), 'error');
  }
}

start();
