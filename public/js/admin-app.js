/**
 * EMBEDX Coordinator Admin Console Logic
 * Strictly restricted to: 814725105014@trp.srmtrichy.edu.in
 */

import {
  allowStudentRetake,
  getActiveAdminSession,
  getBackendStatus,
  loadPortalSettings,
  loadQuestions,
  loginAdmin,
  logoutAdmin,
  resetQuestionsToDefault,
  savePortalSettings,
  saveQuestions,
  subscribeToAdminData,
  updateSubmissionCertificateStatus
} from './db-service.js';
import {
  buildCamsCompatibleCsv,
  buildVerificationLink,
  issueCamsCertificate,
  pingCamsWebhook
} from './cams-client.js';
import { getEffectiveFirebaseConfig, isFirebaseConfigured } from './firebase-config.js';

let settings = null;
let questions = [];
let allSubmissions = [];
let liveSessions = [];
let unsubData = null;

const loginView = document.getElementById('admin-login-view');
const dashView = document.getElementById('admin-dashboard-view');

/* -------------------------------------------------------------------------- */
/* Startup & Auth Gate                                                        */
/* -------------------------------------------------------------------------- */

async function initAdmin() {
  bindLoginEvents();
  bindDashboardEvents();

  const session = await getActiveAdminSession();
  if (session) {
    await enterDashboard(session);
  } else {
    showLoginView();
  }
}

function showLoginView() {
  if (unsubData) {
    unsubData();
    unsubData = null;
  }
  dashView.classList.add('hidden');
  loginView.classList.remove('hidden');
}

async function enterDashboard(session) {
  loginView.classList.add('hidden');
  dashView.classList.remove('hidden');

  const backend = await getBackendStatus();
  const modeLabel =
    backend.mode === 'firebase' && backend.firestoreCloudHealthy
      ? `Cloud Firestore Live (${backend.projectId})`
      : backend.mode === 'firebase'
      ? `Connected to ${backend.projectId} (Enable Firestore & Email Auth in Console)`
      : 'Preview / Local Sync Mode';
  document.getElementById('admin-backend-badge').textContent = `${session.email} · ${modeLabel}`;

  const setupAlert = document.getElementById('firebase-console-setup-alert');
  if (setupAlert) {
    setupAlert.classList.toggle(
      'hidden',
      backend.mode === 'firebase' &&
        backend.firestoreCloudHealthy &&
        session.mode !== 'firebase_pending_console_toggle'
    );
  }

  settings = await loadPortalSettings();
  questions = await loadQuestions();

  populateSettingsForms();
  renderQuestionsBank();
  loadWebhookScriptPreview();

  if (unsubData) unsubData();
  unsubData = await subscribeToAdminData(({ submissions, activeSessions, firestoreCloudHealthy }) => {
    allSubmissions = submissions || [];
    liveSessions = activeSessions || [];
    const setupAlertEl = document.getElementById('firebase-console-setup-alert');
    if (setupAlertEl) {
      setupAlertEl.classList.toggle(
        'hidden',
        Boolean(firestoreCloudHealthy) && session.mode !== 'firebase_pending_console_toggle'
      );
    }
    renderKPIs();
    renderLiveSessions();
    renderSubmissionsTable();
  });
}

function showToast(msg, isError = false) {
  const el = document.getElementById('admin-toast');
  el.textContent = msg;
  el.className = `alert ${isError ? 'alert-error' : 'alert-success'}`;
  el.classList.remove('hidden');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), 4500);
}

/* -------------------------------------------------------------------------- */
/* Login Events                                                               */
/* -------------------------------------------------------------------------- */

function bindLoginEvents() {
  const pwInput = document.getElementById('admin-password');
  const toggleBtn = document.getElementById('btn-toggle-pw');
  toggleBtn.addEventListener('click', () => {
    const isPw = pwInput.type === 'password';
    pwInput.type = isPw ? 'text' : 'password';
    toggleBtn.textContent = isPw ? 'Hide' : 'Show';
  });

  document.getElementById('admin-login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('admin-login-error');
    errEl.classList.add('hidden');

    const email = document.getElementById('admin-email').value.trim();
    const password = pwInput.value;

    const btn = document.getElementById('btn-admin-signin');
    btn.disabled = true;
    btn.textContent = 'Verifying Admin Credentials...';

    try {
      const session = await loginAdmin(email, password);
      pwInput.value = '';
      await enterDashboard(session);
    } catch (err) {
      errEl.textContent = err?.message || 'Authentication failed.';
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign In to Admin Console →';
    }
  });

  document.getElementById('btn-admin-logout').addEventListener('click', async () => {
    await logoutAdmin();
    showLoginView();
  });
}

/* -------------------------------------------------------------------------- */
/* Dashboard Events & Tabs                                                    */
/* -------------------------------------------------------------------------- */

function bindDashboardEvents() {
  // Tabs
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.admin-tab-panel').forEach((p) => {
        p.classList.toggle('hidden', p.id !== `tab-${target}`);
      });
    });
  });

  // Quick Quiz Open/Close toggle
  document.getElementById('btn-quick-toggle-quiz').addEventListener('click', async () => {
    settings = await savePortalSettings({ quizOpen: !settings.quizOpen });
    populateSettingsForms();
    showToast(settings.quizOpen ? 'Quiz is now OPEN for students.' : 'Quiz is now PAUSED.');
  });

  // Quick Result Visibility selector
  document.getElementById('quick-result-visibility').addEventListener('change', async (e) => {
    settings = await savePortalSettings({ resultVisibility: e.target.value });
    showToast('Updated student post-submission result display mode.');
  });

  // Search & Filter
  document.getElementById('sub-search-input').addEventListener('input', renderSubmissionsTable);
  document.getElementById('sub-filter-select').addEventListener('change', renderSubmissionsTable);

  // Bulk Issue Pending Certificates
  document.getElementById('btn-bulk-issue-certs').addEventListener('click', handleBulkIssueCertificates);

  // CSV Exports
  document.getElementById('btn-export-cams-csv').addEventListener('click', () => {
    if (!allSubmissions.length) return showToast('No submissions to export yet.', true);
    const csv = buildCamsCompatibleCsv(allSubmissions, settings);
    downloadTextFile(csv, `EMBEDX_CAMS_Sheet_Responses_${todayStamp()}.csv`, 'text/csv;charset=utf-8');
  });

  document.getElementById('btn-export-full-csv').addEventListener('click', () => {
    if (!allSubmissions.length) return showToast('No submissions to export yet.', true);
    const csv = buildDetailedResultsCsv(allSubmissions);
    downloadTextFile(csv, `EMBEDX_Quiz_Results_${todayStamp()}.csv`, 'text/csv;charset=utf-8');
  });

  // Settings Form (Tab 2)
  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    settings = await savePortalSettings({
      quizTitle: document.getElementById('cfg-quiz-title').value.trim(),
      workshopName: document.getElementById('cfg-workshop-name').value.trim(),
      durationMinutes: Math.max(5, Number(document.getElementById('cfg-duration').value || 30)),
      examAccessCode: document.getElementById('cfg-hall-pin').value.trim(),
      maxWarnings: Math.max(0, Number(document.getElementById('cfg-max-warnings').value ?? 2)),
      returnGraceSeconds: Math.max(5, Number(document.getElementById('cfg-grace-sec').value ?? 20)),
      certificateMode: document.getElementById('cfg-cert-mode').value,
      minScorePercentForCert: Number(document.getElementById('cfg-min-score').value || 0),
      shuffleQuestions: document.getElementById('cfg-shuffle-q').checked,
      shuffleOptions: document.getElementById('cfg-shuffle-opt').checked,
      requireFullscreen: document.getElementById('cfg-fullscreen').checked,
      canvasAntiSearch: document.getElementById('cfg-canvas-shield').checked,
      watermarkRegNo: document.getElementById('cfg-watermark').checked
    });
    populateSettingsForms();
    showToast('Saved quiz & security configuration.');
  });

  // Question Bank Buttons (Tab 3)
  document.getElementById('btn-add-question').addEventListener('click', () => openQuestionEditor(-1));
  document.getElementById('btn-reset-questions').addEventListener('click', async () => {
    if (!confirm('Reset the question bank back to the original 30 EMBEDX PDF questions?')) return;
    questions = await resetQuestionsToDefault();
    renderQuestionsBank();
    showToast('Restored default 30 EMBEDX Workshop questions.');
  });

  document.getElementById('qedit-type').addEventListener('change', () => {
    renderQuestionModalOptionInputs(document.getElementById('qedit-type').value, []);
  });
  document.getElementById('btn-cancel-qmodal').addEventListener('click', () => {
    document.getElementById('question-modal').classList.add('hidden');
  });
  document.getElementById('question-edit-form').addEventListener('submit', handleSaveQuestionModal);

  // CAMS Config Form (Tab 4)
  document.getElementById('cams-config-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    settings = await savePortalSettings({
      camsEnabled: document.getElementById('cams-enabled').checked,
      camsWebhookUrl: document.getElementById('cams-webhook-url').value.trim(),
      camsVerificationUrl: document.getElementById('cams-verify-url').value.trim(),
      camsApiSecret: document.getElementById('cams-secret').value.trim(),
      courseDuration: document.getElementById('cams-duration').value.trim(),
      conductedBy: document.getElementById('cams-conducted-by').value.trim()
    });
    showToast('Saved CAMS Certificate integration settings.');
  });

  document.getElementById('btn-test-cams').addEventListener('click', async () => {
    const out = document.getElementById('cams-ping-result');
    out.className = 'alert alert-info';
    out.textContent = 'Pinging CAMS Google Apps Script Web App...';
    out.classList.remove('hidden');

    const tempSettings = {
      ...settings,
      camsWebhookUrl: document.getElementById('cams-webhook-url').value.trim(),
      camsApiSecret: document.getElementById('cams-secret').value.trim()
    };
    const res = await pingCamsWebhook(tempSettings);
    out.className = `alert ${res.ok ? 'alert-success' : 'alert-error'}`;
    out.textContent = res.message;
  });

  document.getElementById('btn-copy-webhook-gs').addEventListener('click', async () => {
    const code = document.getElementById('webhook-gs-preview').textContent;
    await navigator.clipboard.writeText(code);
    showToast('Copied QuizWebhook.gs to clipboard!');
  });

  // Firebase Runtime Config Box (Tab 4)
  document.getElementById('btn-save-firebase-cfg').addEventListener('click', () => {
    const raw = document.getElementById('firebase-json-input').value.trim();
    if (!raw) return showToast('Paste your firebaseConfig JSON object first.', true);
    try {
      // Support pasting either pure JSON or `const firebaseConfig = { ... };`
      const cleaned = raw
        .replace(/^[^{]*=/, '')
        .replace(/;\s*$/, '')
        .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?\s*:/g, '"$2":')
        .replace(/'/g, '"');
      const parsed = JSON.parse(cleaned);
      if (!parsed.apiKey || !parsed.projectId) {
        return showToast('Config must contain apiKey and projectId.', true);
      }
      localStorage.setItem('embedx_firebase_config_override', JSON.stringify(parsed));
      showToast('Firebase config saved! Reloading console in Cloud Mode...');
      setTimeout(() => window.location.reload(), 900);
    } catch (err) {
      showToast('Invalid JSON format. Copy the { apiKey: "...", projectId: "..." } block.', true);
    }
  });

  document.getElementById('btn-clear-firebase-cfg').addEventListener('click', () => {
    localStorage.removeItem('embedx_firebase_config_override');
    showToast('Cleared browser override. Reloading...');
    setTimeout(() => window.location.reload(), 700);
  });

  // Close Detail Modal
  document.getElementById('btn-close-detail-modal').addEventListener('click', () => {
    document.getElementById('detail-modal').classList.add('hidden');
  });
}

/* -------------------------------------------------------------------------- */
/* Populate Forms & Render KPIs / Tables                                      */
/* -------------------------------------------------------------------------- */

function populateSettingsForms() {
  if (!settings) return;
  const openBtn = document.getElementById('btn-quick-toggle-quiz');
  if (settings.quizOpen) {
    openBtn.textContent = '● Quiz Status: OPEN';
    openBtn.className = 'btn btn-gold btn-sm';
  } else {
    openBtn.textContent = '⏸ Quiz Status: PAUSED';
    openBtn.className = 'btn btn-danger btn-sm';
  }

  document.getElementById('quick-result-visibility').value =
    settings.resultVisibility || 'score_only';

  document.getElementById('cfg-quiz-title').value = settings.quizTitle || '';
  document.getElementById('cfg-workshop-name').value = settings.workshopName || '';
  document.getElementById('cfg-duration').value = settings.durationMinutes ?? 30;
  document.getElementById('cfg-hall-pin').value = settings.examAccessCode || '';
  document.getElementById('cfg-max-warnings').value = settings.maxWarnings ?? 2;
  document.getElementById('cfg-grace-sec').value = settings.returnGraceSeconds ?? 20;
  document.getElementById('cfg-cert-mode').value = settings.certificateMode || 'all_completions';
  document.getElementById('cfg-min-score').value = settings.minScorePercentForCert ?? 0;

  document.getElementById('cfg-shuffle-q').checked = settings.shuffleQuestions !== false;
  document.getElementById('cfg-shuffle-opt').checked = settings.shuffleOptions !== false;
  document.getElementById('cfg-fullscreen').checked = settings.requireFullscreen !== false;
  document.getElementById('cfg-canvas-shield').checked = settings.canvasAntiSearch !== false;
  document.getElementById('cfg-watermark').checked = settings.watermarkRegNo !== false;

  document.getElementById('cams-enabled').checked = settings.camsEnabled !== false;
  document.getElementById('cams-webhook-url').value = settings.camsWebhookUrl || '';
  document.getElementById('cams-verify-url').value = settings.camsVerificationUrl || '';
  document.getElementById('cams-secret').value = settings.camsApiSecret || '';
  document.getElementById('cams-duration').value = settings.courseDuration || '1 Day';
  document.getElementById('cams-conducted-by').value = settings.conductedBy || '';

  const effFb = getEffectiveFirebaseConfig();
  if (isFirebaseConfigured(effFb)) {
    document.getElementById('firebase-json-input').value = JSON.stringify(effFb, null, 2);
  }
}

function renderKPIs() {
  const total = allSubmissions.length;
  const avg =
    total > 0
      ? Math.round(allSubmissions.reduce((acc, s) => acc + Number(s.percentage || 0), 0) / total)
      : 0;
  const autoCount = allSubmissions.filter((s) => s.isAutoSubmitted).length;
  const warnTotal = allSubmissions.reduce((acc, s) => acc + Number(s.warningsUsed || 0), 0);
  const certsSent = allSubmissions.filter((s) => s.certificateStatus === 'SENT').length;

  // Filter live sessions updated within last 2 minutes
  const freshLive = liveSessions.filter((ls) => {
    const t = ls.lastUpdatedAt ? new Date(ls.lastUpdatedAt).getTime() : 0;
    return Date.now() - t < 120000;
  });

  document.getElementById('kpi-total-sub').textContent = String(total);
  document.getElementById('kpi-live-active').textContent = String(freshLive.length);
  document.getElementById('kpi-avg-score').textContent = `${avg}%`;
  document.getElementById('kpi-auto-sub').textContent = String(autoCount);
  document.getElementById('kpi-warnings').textContent = String(warnTotal);
  document.getElementById('kpi-certs-sent').textContent = String(certsSent);
}

function renderLiveSessions() {
  const card = document.getElementById('live-sessions-card');
  const list = document.getElementById('live-sessions-list');
  const freshLive = liveSessions.filter((ls) => {
    const t = ls.lastUpdatedAt ? new Date(ls.lastUpdatedAt).getTime() : 0;
    return Date.now() - t < 120000;
  });

  if (!freshLive.length) {
    card.classList.add('hidden');
    return;
  }

  card.classList.remove('hidden');
  list.innerHTML = '';
  freshLive.forEach((ls) => {
    const div = document.createElement('div');
    div.style.padding = '12px';
    div.style.borderRadius = '10px';
    div.style.background = '#fbf9ff';
    div.style.border = ls.inWarningState
      ? '1.5px solid #dc2626'
      : '1.5px solid rgba(217, 119, 6, 0.35)';
    div.innerHTML = `
      <div style="font-weight:800; font-size:13.5px; color:#3b0764;">${escapeHtml(ls.fullName)}</div>
      <div style="font-size:12px; color:var(--text-muted);">${escapeHtml(ls.registerNumber)} · ${escapeHtml(ls.year || 'EEE')}</div>
      <div style="display:flex; justify-content:space-between; margin-top:8px; font-size:12px;">
        <span>Progress: <b>${ls.answeredCount || 0}/${ls.totalQuestions || 30}</b></span>
        <span style="color:${ls.warningsUsed > 0 ? '#b91c1c' : '#047857'}; font-weight:700;">
          ${ls.inWarningState ? '⚠ 20s LOCKOUT!' : `${ls.warningsUsed || 0}/${ls.maxWarnings ?? 2} Warn`}
        </span>
      </div>
    `;
    list.appendChild(div);
  });
}

function renderSubmissionsTable() {
  const tbody = document.getElementById('submissions-tbody');
  const q = document.getElementById('sub-search-input').value.trim().toLowerCase();
  const filter = document.getElementById('sub-filter-select').value;

  const filtered = allSubmissions.filter((s) => {
    if (filter === 'autosubmit' && !s.isAutoSubmitted) return false;
    if (filter === 'warned' && !(Number(s.warningsUsed || 0) > 0)) return false;
    if (filter === 'cert_sent' && s.certificateStatus !== 'SENT') return false;
    if (filter === 'cert_pending' && s.certificateStatus === 'SENT') return false;

    if (!q) return true;
    const hay = `${s.fullName} ${s.registerNumber} ${s.email} ${s.department} ${s.certificateId || ''}`.toLowerCase();
    return hay.includes(q);
  });

  if (!filtered.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center; color:var(--text-muted); padding:26px;">
          No matching submissions found.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = '';
  filtered.forEach((s) => {
    const tr = document.createElement('tr');
    const mins = Math.floor((s.elapsedSeconds || 0) / 60);
    const secs = (s.elapsedSeconds || 0) % 60;

    const secTag = s.isAutoSubmitted
      ? `<span class="status-tag bad" title="${escapeHtml(s.submitReason)}">Auto-Submit (${s.warningsUsed || 0}W)</span>`
      : Number(s.warningsUsed || 0) > 0
      ? `<span class="status-tag warn">${s.warningsUsed}/${s.maxWarnings ?? 2} Warnings</span>`
      : `<span class="status-tag ok">Clean (0W)</span>`;

    const certTag =
      s.certificateStatus === 'SENT'
        ? `<span class="status-tag ok">✓ Sent</span><div style="font-size:11px; color:var(--text-muted); margin-top:2px; font-family:monospace;">${escapeHtml(s.certificateId || '')}</div>`
        : `<span class="status-tag warn">${escapeHtml(s.certificateStatus || 'Pending')}</span>`;

    tr.innerHTML = `
      <td>
        <div style="font-weight:700;">${escapeHtml(s.fullName)}</div>
        <div style="font-size:11.5px; color:var(--text-muted);">${escapeHtml(s.email)}</div>
        <div style="font-size:11px; color:var(--text-muted);">${escapeHtml(s.phone || '')}</div>
      </td>
      <td>
        <div style="font-family:monospace; font-weight:800; color:#3b0764;">${escapeHtml(s.registerNumber)}</div>
        <div style="font-size:11.5px; color:var(--text-muted);">EEE · ${escapeHtml(s.year)}</div>
      </td>
      <td>
        <strong style="font-size:15px; color:#5b21b6;">${s.score}/${s.totalQuestions}</strong>
        <div style="font-size:11.5px; color:#b45309; font-weight:700;">${s.percentage}%</div>
      </td>
      <td>${mins}m ${secs}s</td>
      <td>${secTag}</td>
      <td>${certTag}</td>
      <td>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button type="button" class="btn btn-secondary btn-sm act-inspect">Details</button>
          <button type="button" class="btn btn-primary btn-sm act-cert">
            ${s.certificateStatus === 'SENT' ? 'Resend' : 'Issue Cert'}
          </button>
          <button type="button" class="btn btn-danger btn-sm act-retake" title="Delete attempt & allow retake">↺</button>
        </div>
      </td>
    `;

    tr.querySelector('.act-inspect').addEventListener('click', () => openSubmissionModal(s));
    tr.querySelector('.act-cert').addEventListener('click', (ev) =>
      handleSingleCertificateIssue(s, ev.currentTarget)
    );
    tr.querySelector('.act-retake').addEventListener('click', async () => {
      if (
        !confirm(
          `Allow ${s.fullName} (${s.registerNumber}) to retake the quiz? This removes their current submission lock.`
        )
      )
        return;
      await allowStudentRetake(s.id);
      showToast(`Cleared submission for ${s.fullName}. They may now re-attempt.`);
    });

    tbody.appendChild(tr);
  });
}

/* -------------------------------------------------------------------------- */
/* CAMS Manual & Bulk Trigger Handlers                                        */
/* -------------------------------------------------------------------------- */

async function handleSingleCertificateIssue(submission, btnEl) {
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = 'Sending...';
  }
  try {
    const res = await issueCamsCertificate(submission, settings);
    if (res.ok) {
      await updateSubmissionCertificateStatus(submission.id, {
        certificateStatus: 'SENT',
        certificateId: res.certificateId || '',
        certificatePdfUrl: res.pdfUrl || '',
        certificateSentAt: new Date().toISOString(),
        certificateError: ''
      });
      showToast(`Certificate ${res.certificateId} sent to ${submission.email}!`);
    } else {
      await updateSubmissionCertificateStatus(submission.id, {
        certificateStatus: res.status || 'FAILED',
        certificateError: res.message || ''
      });
      showToast(res.message, true);
    }
  } finally {
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.textContent = 'Issue Cert';
    }
  }
}

async function handleBulkIssueCertificates() {
  const pending = allSubmissions.filter((s) => s.certificateStatus !== 'SENT');
  if (!pending.length) {
    return showToast('All submitted participants already have Sent certificates!');
  }
  const btn = document.getElementById('btn-bulk-issue-certs');
  btn.disabled = true;

  let sentCount = 0;
  let lastErr = '';
  for (let i = 0; i < pending.length; i++) {
    btn.textContent = `Issuing ${i + 1}/${pending.length}...`;
    const res = await issueCamsCertificate(pending[i], settings);
    if (res.ok) {
      sentCount++;
      await updateSubmissionCertificateStatus(pending[i].id, {
        certificateStatus: 'SENT',
        certificateId: res.certificateId || '',
        certificatePdfUrl: res.pdfUrl || '',
        certificateSentAt: new Date().toISOString(),
        certificateError: ''
      });
    } else {
      lastErr = res.message;
      await updateSubmissionCertificateStatus(pending[i].id, {
        certificateStatus: res.status || 'QUEUED_RETRY',
        certificateError: res.message || ''
      });
      if (res.status === 'QUEUED_WEBHOOK_SETUP_NEEDED') break;
    }
  }

  btn.disabled = false;
  btn.textContent = '✉ Issue All Pending Certificates';

  if (sentCount > 0) {
    showToast(`Issued & emailed ${sentCount} CAMS certificate(s)!`);
  } else {
    showToast(lastErr || 'Could not issue pending certificates yet. Check Tab 4 CAMS setup.', true);
  }
}

/* -------------------------------------------------------------------------- */
/* Submission Inspection Modal (Violation Timeline + Answers)                 */
/* -------------------------------------------------------------------------- */

function openSubmissionModal(s) {
  document.getElementById('detail-modal-title').textContent = `${s.fullName} (${s.registerNumber})`;
  const body = document.getElementById('detail-modal-body');

  const violations = Array.isArray(s.violations) ? s.violations : [];
  const violationHtml = violations.length
    ? violations
        .map(
          (v) => `
        <div style="padding:8px 10px; border-radius:8px; background:#fef2f2; border:1px solid #fecaca; color:#991b1b; font-size:12.5px; margin-bottom:6px;">
          <strong>Incident #${v.incidentNumber}:</strong> ${escapeHtml(v.reason)}
          <div style="font-size:11px; color:#7f1d1d;">${new Date(v.timestamp).toLocaleString()}</div>
        </div>`
        )
        .join('')
    : `<div style="font-size:13px; color:#047857; font-weight:600;">✓ Zero security violations recorded.</div>`;

  const verifyUrl = s.certificateId
    ? buildVerificationLink(settings.camsVerificationUrl || settings.camsWebhookUrl, s.certificateId)
    : '';

  const breakdownHtml = Array.isArray(s.breakdown)
    ? s.breakdown
        .map(
          (b, idx) => `
        <div style="padding:8px 10px; border-bottom:1px solid rgba(91,33,182,0.1); font-size:12.5px;">
          <div style="color:#1e1035;"><strong>Q${idx + 1}.</strong> ${escapeHtml(b.question)}</div>
          <div style="color:${b.isCorrect ? '#047857' : '#b91c1c'}; margin-top:2px;">
            Selected: <b>${escapeHtml(b.selectedText)}</b> ${
            b.isCorrect ? '✓' : `(Correct: ${escapeHtml(b.correctText)})`
          }
          </div>
        </div>`
        )
        .join('')
    : '';

  body.innerHTML = `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:13px; margin-bottom:14px; padding:12px; background:#fbf9ff; border:1px solid rgba(217,119,6,0.3); border-radius:10px;">
      <div><strong>Email:</strong> ${escapeHtml(s.email)}</div>
      <div><strong>Mobile:</strong> ${escapeHtml(s.phone || '-')}</div>
      <div><strong>Dept / Year:</strong> EEE · ${escapeHtml(s.year)}</div>
      <div><strong>College:</strong> SRM TRP Engineering College</div>
      <div><strong>Score:</strong> ${s.score}/${s.totalQuestions} (${s.percentage}%)</div>
      <div><strong>Submit Reason:</strong> ${escapeHtml(s.submitReason)}</div>
      <div><strong>Cert Status:</strong> ${escapeHtml(s.certificateStatus)}</div>
      <div><strong>Cert ID:</strong> ${
        verifyUrl
          ? `<a href="${escapeHtml(verifyUrl)}" target="_blank" style="color:#5b21b6; font-weight:700;">${escapeHtml(s.certificateId)} ↗</a>`
          : '-'
      }</div>
    </div>

    <h4 style="margin:12px 0 8px; font-size:14px; color:#3b0764;">Proctoring &amp; Violation Timeline (${violations.length})</h4>
    ${violationHtml}

    <h4 style="margin:16px 0 8px; font-size:14px; color:#3b0764;">Question-by-Question Responses</h4>
    <div style="max-height:280px; overflow-y:auto; border:1px solid rgba(91,33,182,0.16); border-radius:10px; background:#fff;">
      ${breakdownHtml}
    </div>
  `;

  document.getElementById('detail-modal').classList.remove('hidden');
}

/* -------------------------------------------------------------------------- */
/* Question Bank Editor (Tab 3)                                               */
/* -------------------------------------------------------------------------- */

function renderQuestionsBank() {
  document.getElementById('qbank-count').textContent = String(questions.length);
  const wrap = document.getElementById('questions-admin-list');
  wrap.innerHTML = '';

  questions.forEach((q, idx) => {
    const card = document.createElement('div');
    card.style.padding = '14px';
    card.style.borderRadius = '12px';
    card.style.background = '#fbf9ff';
    card.style.border = '1px solid rgba(91, 33, 182, 0.16)';
    card.style.borderLeft = '3.5px solid #d97706';

    const optsHtml = q.options
      .map(
        (opt, oIdx) => `
        <div style="font-size:13px; padding:3px 0; font-weight:${
          oIdx === Number(q.correctIndex) ? '700' : '500'
        }; color:${
          oIdx === Number(q.correctIndex) ? '#047857' : 'var(--text-secondary)'
        };">
          ${oIdx === Number(q.correctIndex) ? '✓' : '○'} ${escapeHtml(opt)}
        </div>`
      )
      .join('');

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">
        <div>
          <span style="font-size:11px; color:#5b21b6; font-weight:800; text-transform:uppercase;">
            Q${idx + 1} · ${escapeHtml(q.category || 'General')} (${q.type === 'tf' ? 'True/False' : 'MCQ'})
          </span>
          <div style="font-weight:700; font-size:14.5px; margin:4px 0 8px; color:#1e1035;">${escapeHtml(q.question)}</div>
          ${optsHtml}
        </div>
        <div style="display:flex; gap:6px; flex-shrink:0;">
          <button type="button" class="btn btn-secondary btn-sm q-edit">Edit</button>
          <button type="button" class="btn btn-danger btn-sm q-del">✕</button>
        </div>
      </div>
    `;

    card.querySelector('.q-edit').addEventListener('click', () => openQuestionEditor(idx));
    card.querySelector('.q-del').addEventListener('click', async () => {
      if (questions.length <= 1) return showToast('Quiz must have at least 1 question.', true);
      if (!confirm(`Delete Question #${idx + 1}?`)) return;
      questions.splice(idx, 1);
      await saveQuestions(questions);
      renderQuestionsBank();
      showToast('Deleted question.');
    });

    wrap.appendChild(card);
  });
}

function openQuestionEditor(idx) {
  document.getElementById('qedit-idx').value = String(idx);
  const isNew = idx < 0;
  document.getElementById('qmodal-title').textContent = isNew
    ? 'Add New Question'
    : `Edit Question #${idx + 1}`;

  const q = isNew
    ? {
        category: 'Embedded Systems',
        type: 'mcq',
        question: '',
        options: ['', '', '', ''],
        correctIndex: 0,
        explanation: ''
      }
    : questions[idx];

  document.getElementById('qedit-category').value = q.category || '';
  document.getElementById('qedit-type').value = q.type || 'mcq';
  document.getElementById('qedit-prompt').value = q.question || '';
  document.getElementById('qedit-explanation').value = q.explanation || '';

  renderQuestionModalOptionInputs(q.type || 'mcq', q.options || [], q.correctIndex || 0);
  document.getElementById('question-modal').classList.remove('hidden');
}

function renderQuestionModalOptionInputs(type, values = [], correctIdx = 0) {
  const wrap = document.getElementById('qedit-options-wrap');
  const sel = document.getElementById('qedit-correct');
  wrap.innerHTML = '';
  sel.innerHTML = '';

  const opts = type === 'tf' ? ['True', 'False'] : [values[0] || '', values[1] || '', values[2] || '', values[3] || ''];
  const letters = ['A', 'B', 'C', 'D'];

  opts.forEach((val, i) => {
    const div = document.createElement('div');
    div.className = 'field';
    div.innerHTML = `
      <label>Option ${type === 'tf' ? i + 1 : letters[i]}</label>
      <input type="text" class="qedit-opt-input" value="${escapeHtml(val)}" ${type === 'tf' ? 'readonly' : 'required'} />
    `;
    wrap.appendChild(div);

    const optEl = document.createElement('option');
    optEl.value = String(i);
    optEl.textContent = type === 'tf' ? val : `Option ${letters[i]}`;
    if (i === Number(correctIdx)) optEl.selected = true;
    sel.appendChild(optEl);
  });
}

async function handleSaveQuestionModal(e) {
  e.preventDefault();
  const idx = Number(document.getElementById('qedit-idx').value);
  const type = document.getElementById('qedit-type').value;
  const options = Array.from(document.querySelectorAll('.qedit-opt-input')).map((el) =>
    el.value.trim()
  );

  const item = {
    id: idx >= 0 && questions[idx] ? questions[idx].id : Date.now(),
    category: document.getElementById('qedit-category').value.trim(),
    type,
    question: document.getElementById('qedit-prompt').value.trim(),
    options,
    correctIndex: Number(document.getElementById('qedit-correct').value),
    explanation: document.getElementById('qedit-explanation').value.trim()
  };

  if (idx >= 0) questions[idx] = item;
  else questions.push(item);

  await saveQuestions(questions);
  document.getElementById('question-modal').classList.add('hidden');
  renderQuestionsBank();
  showToast('Saved question bank.');
}

/* -------------------------------------------------------------------------- */
/* Utilities                                                                  */
/* -------------------------------------------------------------------------- */

async function loadWebhookScriptPreview() {
  try {
    const res = await fetch('/assets/QuizWebhook.gs.txt');
    if (res.ok) {
      document.getElementById('webhook-gs-preview').textContent = await res.text();
    }
  } catch (_) {}
}

function buildDetailedResultsCsv(submissions) {
  const headers = [
    'Submitted At',
    'Full Name',
    'Register Number',
    'Email',
    'Mobile',
    'Department',
    'Year',
    'College',
    'Score',
    'Total Questions',
    'Percentage',
    'Time Seconds',
    'Warnings Used',
    'Auto Submitted',
    'Submit Reason',
    'Certificate Status',
    'Certificate ID',
    'Certificate PDF URL'
  ];

  const rows = submissions.map((s) => [
    s.submittedAt || '',
    s.fullName || '',
    s.registerNumber || '',
    s.email || '',
    s.phone || '',
    s.department || '',
    s.year || '',
    s.college || '',
    s.score ?? 0,
    s.totalQuestions ?? 30,
    `${s.percentage ?? 0}%`,
    s.elapsedSeconds ?? 0,
    s.warningsUsed ?? 0,
    s.isAutoSubmitted ? 'YES' : 'NO',
    s.submitReason || '',
    s.certificateStatus || '',
    s.certificateId || '',
    s.certificatePdfUrl || ''
  ]);

  return [headers, ...rows]
    .map((r) =>
      r
        .map((c) => {
          const str = String(c ?? '');
          return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
        })
        .join(',')
    )
    .join('\r\n');
}

function downloadTextFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

initAdmin();
