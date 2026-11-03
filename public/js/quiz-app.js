/**
 * EMBEDX Student Mobile-First Quiz Application (EEE Department · SRM TRP Engineering College)
 * Theme: Royal Purple, Metallic Gold & Crisp White
 * Orchestrates Registration -> Security Briefing -> Seeded Shuffling ->
 * Canvas Question Rendering -> 2-Warning/20s Proctor -> CAMS Certificate Issuance.
 */

import {
  checkExistingSubmission,
  loadPortalSettings,
  loadQuestions,
  recordQuizSubmission,
  removeActiveSession,
  updateSubmissionCertificateStatus,
  upsertActiveSession
} from './db-service.js';
import { renderProtectedQuestionCanvas } from './canvas-shield.js';
import { ExamProctor } from './proctor.js';
import { buildVerificationLink, issueCamsCertificate } from './cams-client.js';

const ACTIVE_ATTEMPT_KEY = 'embedx_student_active_attempt_v1';
const FIXED_DEPARTMENT = 'EEE';
const FIXED_COLLEGE = 'SRM TRP Engineering College';

let settings = null;
let rawQuestions = [];
let preparedQuestions = [];
let candidate = null;
let attemptState = null;
let proctor = null;
let quizTimerInterval = null;
let heartbeatInterval = null;

/* -------------------------------------------------------------------------- */
/* Seeded Deterministic PRNG (Mulberry32) so page refresh preserves order     */
/* -------------------------------------------------------------------------- */

function hashStringSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function createSeededRng(seedStr) {
  let a = hashStringSeed(seedStr);
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(array, rng) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildStudentQuestionSet(questions, studentSeed, doShuffleQuestions, doShuffleOptions) {
  const rng = createSeededRng(studentSeed);
  const mapped = questions.map((q) => {
    const indexedOpts = q.options.map((text, origIdx) => ({
      text,
      origIdx,
      isCorrect: origIdx === Number(q.correctIndex)
    }));
    const finalOpts =
      doShuffleOptions && q.type !== 'tf' ? seededShuffle(indexedOpts, rng) : indexedOpts;
    return {
      id: q.id,
      category: q.category || '',
      type: q.type || 'mcq',
      question: q.question,
      explanation: q.explanation || '',
      options: finalOpts.map((o) => o.text),
      correctShuffledIndex: finalOpts.findIndex((o) => o.isCorrect)
    };
  });

  return doShuffleQuestions ? seededShuffle(mapped, rng) : mapped;
}

/* -------------------------------------------------------------------------- */
/* Screen Switching                                                           */
/* -------------------------------------------------------------------------- */

const screens = {
  register: document.getElementById('screen-register'),
  briefing: document.getElementById('screen-briefing'),
  quiz: document.getElementById('screen-quiz'),
  result: document.getElementById('screen-result')
};

function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    if (el) el.classList.toggle('hidden', key !== name);
  });
  const brandHeader = document.getElementById('portal-brand-header');
  if (brandHeader) {
    brandHeader.classList.toggle('hidden', name === 'quiz');
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/* -------------------------------------------------------------------------- */
/* Initialization                                                             */
/* -------------------------------------------------------------------------- */

async function initPortal() {
  settings = await loadPortalSettings();
  rawQuestions = await loadQuestions();

  applySettingsToLandingUI();
  bindUIEvents();

  await tryRestoreActiveAttempt();
}

function applySettingsToLandingUI() {
  document.getElementById('landing-quiz-title').textContent =
    settings.quizTitle || 'EMBEDX Workshop Quiz';
  document.getElementById('landing-workshop-subtitle').textContent =
    settings.workshopName || 'Basics of Embedded Systems and Embedded Programming Language';
  document.getElementById('meta-q-count').textContent = String(rawQuestions.length || 30);
  document.getElementById('meta-duration').textContent = `${settings.durationMinutes || 30} Min`;

  document.getElementById('brief-max-warn').textContent = String(settings.maxWarnings ?? 2);
  document.getElementById('brief-grace-sec').textContent = String(settings.returnGraceSeconds ?? 20);
  document.getElementById('brief-grace-sec-2').textContent = String(settings.returnGraceSeconds ?? 20);
  document.getElementById('brief-grace-sec-3').textContent = String(settings.returnGraceSeconds ?? 20);

  const hasPasscode = Boolean(String(settings.examAccessCode || '').trim());
  document.getElementById('access-code-field').classList.toggle('hidden', !hasPasscode);

  const closedBanner = document.getElementById('quiz-closed-banner');
  const submitBtn = document.getElementById('btn-register-continue');
  const dot = document.getElementById('live-status-dot');
  const statusLabel = document.getElementById('live-status-label');

  if (!settings.quizOpen) {
    closedBanner.classList.remove('hidden');
    submitBtn.disabled = true;
    dot.style.background = '#dc2626';
    statusLabel.textContent = 'Assessment Paused';
  } else {
    closedBanner.classList.add('hidden');
    submitBtn.disabled = false;
    dot.style.background = '#d97706';
    statusLabel.textContent = 'EEE Workshop Assessment';
  }
}

/* -------------------------------------------------------------------------- */
/* Registration & Briefing                                                    */
/* -------------------------------------------------------------------------- */

function showRegisterError(msg) {
  const el = document.getElementById('register-error');
  if (!msg) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.textContent = msg;
  el.classList.remove('hidden');
}

function bindUIEvents() {
  const regForm = document.getElementById('registration-form');
  regForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    showRegisterError('');

    settings = await loadPortalSettings();
    if (!settings.quizOpen) {
      applySettingsToLandingUI();
      return;
    }

    const fullName = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim().toLowerCase();
    const registerNumber = document.getElementById('reg-number').value.trim().toUpperCase();
    const phone = document.getElementById('reg-phone').value.trim().replace(/\s+/g, '');
    const year = document.getElementById('reg-year').value.trim();
    const enteredPin = document.getElementById('reg-passcode').value.trim();

    if (fullName.length < 2) return showRegisterError('Please enter your full name (for certificate printing).');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showRegisterError('Please enter a valid email address.');
    if (registerNumber.length < 4) return showRegisterError('Please enter your valid Register Number.');
    if (!/^\+?\d{10,14}$/.test(phone)) return showRegisterError('Please enter a valid 10-digit mobile number.');
    if (!year) return showRegisterError('Please select your Year of Study.');

    const requiredPin = String(settings.examAccessCode || '').trim();
    if (requiredPin && enteredPin !== requiredPin) {
      return showRegisterError('Incorrect Workshop Hall PIN. Please check with the coordinator.');
    }

    const btn = document.getElementById('btn-register-continue');
    btn.disabled = true;
    btn.textContent = 'Checking Eligibility...';

    try {
      if (!settings.allowDuplicateEmail) {
        const existing = await checkExistingSubmission(email, registerNumber);
        if (existing) {
          renderResultScreen(existing, true);
          return;
        }
      }

      candidate = {
        fullName,
        email,
        registerNumber,
        phone,
        department: FIXED_DEPARTMENT,
        year,
        college: FIXED_COLLEGE
      };

      document.getElementById('brief-student-name').textContent = fullName;
      document.getElementById('brief-student-reg').textContent = registerNumber;
      document.getElementById('brief-student-email').textContent = email;
      document.getElementById('chk-security-consent').checked = false;
      document.getElementById('btn-start-quiz').disabled = true;

      showScreen('briefing');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Register & Proceed to Security Check →';
    }
  });

  const consentChk = document.getElementById('chk-security-consent');
  const startBtn = document.getElementById('btn-start-quiz');
  consentChk.addEventListener('change', () => {
    startBtn.disabled = !consentChk.checked;
  });

  document.getElementById('btn-back-edit-reg').addEventListener('click', () => {
    showScreen('register');
  });

  startBtn.addEventListener('click', async () => {
    if (!candidate) return;
    startBtn.disabled = true;
    startBtn.textContent = 'Locking Screen...';

    try {
      rawQuestions = await loadQuestions();
      const durationMs = Number(settings.durationMinutes || 30) * 60 * 1000;
      const now = Date.now();

      attemptState = {
        candidate,
        startedAt: now,
        deadlineAt: now + durationMs,
        currentIndex: 0,
        answers: {},
        flagged: {},
        warningsUsed: 0,
        violations: [],
        warningOverlayOpen: false,
        warningDeadlineAt: 0,
        currentReason: ''
      };
      persistAttemptLocal();

      if (settings.requireFullscreen && ExamProctor.isFullscreenSupported()) {
        try {
          const el = document.documentElement;
          if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
          else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
        } catch (_) {}
      }

      launchActiveQuiz();
    } finally {
      startBtn.disabled = false;
      startBtn.textContent = 'Lock Screen & Start Quiz';
    }
  });

  document.getElementById('btn-prev-q').addEventListener('click', () => {
    if (!attemptState || attemptState.currentIndex <= 0) return;
    attemptState.currentIndex--;
    persistAttemptLocal();
    renderCurrentQuestion();
  });

  document.getElementById('btn-next-q').addEventListener('click', () => {
    if (!attemptState) return;
    if (attemptState.currentIndex < preparedQuestions.length - 1) {
      attemptState.currentIndex++;
      persistAttemptLocal();
      renderCurrentQuestion();
    } else {
      openSubmitConfirmation();
    }
  });

  document.getElementById('btn-flag-q').addEventListener('click', () => {
    if (!attemptState) return;
    const q = preparedQuestions[attemptState.currentIndex];
    if (!q) return;
    attemptState.flagged[q.id] = !attemptState.flagged[q.id];
    persistAttemptLocal();
    renderCurrentQuestion();
  });

  document.getElementById('btn-open-palette').addEventListener('click', () => {
    renderPaletteGrid();
    document.getElementById('palette-drawer').classList.remove('hidden');
  });
  document.getElementById('btn-close-palette').addEventListener('click', () => {
    document.getElementById('palette-drawer').classList.add('hidden');
  });
  document.getElementById('btn-open-submit-confirm').addEventListener('click', () => {
    document.getElementById('palette-drawer').classList.add('hidden');
    openSubmitConfirmation();
  });

  document.getElementById('btn-cancel-submit').addEventListener('click', () => {
    document.getElementById('submit-confirm-modal').classList.add('hidden');
  });
  document.getElementById('btn-confirm-submit').addEventListener('click', () => {
    document.getElementById('submit-confirm-modal').classList.add('hidden');
    finalizeQuizSubmission('Manual Submit', false);
  });

  document.getElementById('btn-resume-exam').addEventListener('click', async () => {
    if (!proctor) return;
    await proctor.acknowledgeAndResume();
    renderCurrentQuestion();
  });

  window.addEventListener('resize', () => {
    if (!screens.quiz.classList.contains('hidden') && attemptState) {
      renderCurrentQuestion();
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Active Attempt Restore                                                     */
/* -------------------------------------------------------------------------- */

function persistAttemptLocal() {
  if (!attemptState) return;
  try {
    localStorage.setItem(ACTIVE_ATTEMPT_KEY, JSON.stringify(attemptState));
  } catch (_) {}
}

function clearAttemptLocal() {
  try {
    localStorage.removeItem(ACTIVE_ATTEMPT_KEY);
  } catch (_) {}
}

async function tryRestoreActiveAttempt() {
  let saved = null;
  try {
    const raw = localStorage.getItem(ACTIVE_ATTEMPT_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch (_) {
    saved = null;
  }
  if (!saved || !saved.candidate || !saved.deadlineAt) return;

  candidate = saved.candidate;
  attemptState = saved;

  const existing = await checkExistingSubmission(candidate.email, candidate.registerNumber);
  if (existing) {
    clearAttemptLocal();
    renderResultScreen(existing, true);
    return;
  }

  if (Date.now() >= attemptState.deadlineAt) {
    preparedQuestions = buildStudentQuestionSet(
      rawQuestions,
      `${candidate.email}:${candidate.registerNumber}`,
      settings.shuffleQuestions,
      settings.shuffleOptions
    );
    await finalizeQuizSubmission('Time Expired (Auto-Submitted)', true);
    return;
  }

  launchActiveQuiz();
}

/* -------------------------------------------------------------------------- */
/* Quiz Execution & Proctoring Wiring                                         */
/* -------------------------------------------------------------------------- */

function launchActiveQuiz() {
  preparedQuestions = buildStudentQuestionSet(
    rawQuestions,
    `${candidate.email}:${candidate.registerNumber}`,
    settings.shuffleQuestions,
    settings.shuffleOptions
  );

  showScreen('quiz');
  renderCurrentQuestion();

  if (proctor) proctor.stop();
  proctor = new ExamProctor({
    maxWarnings: settings.maxWarnings ?? 2,
    returnGraceSeconds: settings.returnGraceSeconds ?? 20,
    requireFullscreen: settings.requireFullscreen ?? true,
    initialWarningsUsed: attemptState.warningsUsed || 0,
    initialViolations: attemptState.violations || [],
    initialWarningOverlayOpen: attemptState.warningOverlayOpen || false,
    initialWarningDeadlineAt: attemptState.warningDeadlineAt || 0,
    initialReason: attemptState.currentReason || '',
    onStateChange: ({ warningsUsed, maxWarnings }) => {
      updateShieldUI(warningsUsed, maxWarnings);
    },
    onWarning: ({ warningsUsed, maxWarnings, reason, remainingSeconds }) => {
      showWarningCurtainUI(warningsUsed, maxWarnings, reason, remainingSeconds);
      syncHeartbeat();
    },
    onCountdownTick: ({ remainingSeconds }) => {
      const el = document.getElementById('warning-countdown-num');
      if (el) el.textContent = String(remainingSeconds);
    },
    onPersist: (proctorPatch) => {
      if (!attemptState) return;
      Object.assign(attemptState, proctorPatch);
      persistAttemptLocal();
    },
    onAutoSubmit: ({ reason, warningsUsed, violations }) => {
      if (attemptState) {
        attemptState.warningsUsed = warningsUsed;
        attemptState.violations = violations;
      }
      finalizeQuizSubmission(reason, true);
    }
  });
  proctor.start();

  if (quizTimerInterval) clearInterval(quizTimerInterval);
  const tickQuizClock = () => {
    if (!attemptState) return;
    const remMs = attemptState.deadlineAt - Date.now();
    if (remMs <= 0) {
      clearInterval(quizTimerInterval);
      finalizeQuizSubmission('Time Limit Reached (Auto-Submitted)', true);
      return;
    }
    const totalSec = Math.ceil(remMs / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    document.getElementById('exam-timer-text').textContent = `${String(mins).padStart(
      2,
      '0'
    )}:${String(secs).padStart(2, '0')}`;

    const pill = document.getElementById('exam-timer-pill');
    pill.classList.toggle('danger', totalSec <= 60);
    pill.classList.toggle('warn', totalSec > 60 && totalSec <= 300);
  };
  tickQuizClock();
  quizTimerInterval = setInterval(tickQuizClock, 500);

  syncHeartbeat();
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(syncHeartbeat, 10000);
}

function syncHeartbeat() {
  if (!attemptState || !candidate) return;
  const answeredCount = Object.keys(attemptState.answers || {}).length;
  upsertActiveSession({
    fullName: candidate.fullName,
    email: candidate.email,
    registerNumber: candidate.registerNumber,
    department: candidate.department || FIXED_DEPARTMENT,
    year: candidate.year,
    answeredCount,
    totalQuestions: preparedQuestions.length,
    warningsUsed: attemptState.warningsUsed || 0,
    maxWarnings: settings.maxWarnings ?? 2,
    inWarningState: Boolean(attemptState.warningOverlayOpen),
    startedAt: new Date(attemptState.startedAt).toISOString()
  });
}

function updateShieldUI(warningsUsed, maxWarnings) {
  const pill = document.getElementById('exam-shield-pill');
  const txt = document.getElementById('exam-warning-counter');
  txt.textContent = `${warningsUsed}/${maxWarnings} Warn`;
  pill.classList.toggle('has-warning', warningsUsed > 0);
}

function showWarningCurtainUI(warningsUsed, maxWarnings, reason, remainingSeconds) {
  const isFinal = warningsUsed >= maxWarnings;
  document.getElementById('warning-badge-text').textContent = isFinal
    ? `FINAL WARNING ${warningsUsed} OF ${maxWarnings}`
    : `SECURITY WARNING ${warningsUsed} OF ${maxWarnings}`;
  document.getElementById('warning-reason-text').textContent = reason;
  document.getElementById('warning-countdown-num').textContent = String(remainingSeconds);
  document.getElementById('warning-grace-label').textContent = `${settings.returnGraceSeconds ?? 20}s`;
  document.body.classList.add('security-curtain-active');
}

/* -------------------------------------------------------------------------- */
/* Question & Palette Rendering                                               */
/* -------------------------------------------------------------------------- */

function renderCurrentQuestion() {
  if (!attemptState || !preparedQuestions.length) return;
  const idx = attemptState.currentIndex;
  const q = preparedQuestions[idx];
  const total = preparedQuestions.length;

  const answeredCount = Object.keys(attemptState.answers).length;
  document.getElementById('answered-counter-text').textContent = `${answeredCount}/${total}`;
  document.getElementById('exam-progress-fill').style.width = `${Math.round(
    ((idx + 1) / total) * 100
  )}%`;

  const canvas = document.getElementById('question-canvas');
  const fallbackEl = document.getElementById('question-fallback-text');
  renderProtectedQuestionCanvas(canvas, {
    questionNumber: idx + 1,
    totalQuestions: total,
    category: q.category,
    questionText: q.question,
    watermarkText: settings.watermarkRegNo !== false ? candidate.registerNumber : '',
    canvasAntiSearch: settings.canvasAntiSearch !== false,
    fallbackTextEl: fallbackEl
  });

  const container = document.getElementById('options-container');
  container.innerHTML = '';
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  const selectedIdx = attemptState.answers[q.id];

  q.options.forEach((optText, optIdx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'option-btn' + (selectedIdx === optIdx ? ' selected' : '');

    const badge = document.createElement('span');
    badge.className = 'option-letter';
    badge.textContent = q.type === 'tf' ? (optIdx === 0 ? 'T' : 'F') : letters[optIdx] || String(optIdx + 1);

    const label = document.createElement('span');
    label.textContent = optText;

    btn.appendChild(badge);
    btn.appendChild(label);

    btn.addEventListener('click', () => {
      attemptState.answers[q.id] = optIdx;
      persistAttemptLocal();
      renderCurrentQuestion();
    });

    container.appendChild(btn);
  });

  document.getElementById('btn-prev-q').disabled = idx === 0;
  const flagBtn = document.getElementById('btn-flag-q');
  const isFlagged = Boolean(attemptState.flagged[q.id]);
  flagBtn.textContent = isFlagged ? '⚑ Marked' : '⚑ Review';
  flagBtn.style.borderColor = isFlagged ? '#d97706' : '';
  flagBtn.style.background = isFlagged ? '#fffbeb' : '';
  flagBtn.style.color = isFlagged ? '#b45309' : '';

  const nextBtn = document.getElementById('btn-next-q');
  if (idx === total - 1) {
    nextBtn.textContent = 'Finish & Submit ✓';
    nextBtn.className = 'btn btn-gold';
  } else {
    nextBtn.textContent = 'Next →';
    nextBtn.className = 'btn btn-primary';
  }
}

function renderPaletteGrid() {
  const grid = document.getElementById('palette-grid');
  grid.innerHTML = '';
  preparedQuestions.forEach((q, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const isAnswered = attemptState.answers[q.id] !== undefined;
    const isFlagged = Boolean(attemptState.flagged[q.id]);
    const isCurrent = idx === attemptState.currentIndex;

    btn.className =
      'palette-cell' +
      (isAnswered ? ' answered' : '') +
      (isFlagged ? ' flagged' : '') +
      (isCurrent ? ' current' : '');
    btn.textContent = String(idx + 1);
    btn.addEventListener('click', () => {
      attemptState.currentIndex = idx;
      persistAttemptLocal();
      document.getElementById('palette-drawer').classList.add('hidden');
      renderCurrentQuestion();
    });
    grid.appendChild(btn);
  });
}

function openSubmitConfirmation() {
  const answered = Object.keys(attemptState.answers).length;
  const total = preparedQuestions.length;
  const unanswered = total - answered;
  document.getElementById('submit-summary-text').textContent =
    unanswered === 0
      ? `Great job! You have answered all ${total} questions. Ready to submit?`
      : `You have answered ${answered} of ${total} questions (${unanswered} unanswered). Once submitted, you cannot re-enter.`;
  document.getElementById('submit-confirm-modal').classList.remove('hidden');
}

/* -------------------------------------------------------------------------- */
/* Submission, Grading & Automated CAMS Certificate Trigger                   */
/* -------------------------------------------------------------------------- */

let isSubmittingNow = false;

async function finalizeQuizSubmission(submitReason = 'Manual Submit', isAutoSubmitted = false) {
  if (isSubmittingNow || !attemptState) return;
  isSubmittingNow = true;

  if (proctor) proctor.stop();
  if (quizTimerInterval) clearInterval(quizTimerInterval);
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  ExamProctor.exitFullscreenSafe();

  let score = 0;
  const detailedBreakdown = preparedQuestions.map((q) => {
    const chosenIdx = attemptState.answers[q.id];
    const isCorrect = chosenIdx !== undefined && chosenIdx === q.correctShuffledIndex;
    if (isCorrect) score++;
    return {
      questionId: q.id,
      question: q.question,
      selectedText: chosenIdx !== undefined ? q.options[chosenIdx] : '(Not Answered)',
      correctText: q.options[q.correctShuffledIndex],
      isCorrect,
      explanation: q.explanation
    };
  });

  const totalQuestions = preparedQuestions.length;
  const percentage = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;
  const elapsedSeconds = Math.max(1, Math.round((Date.now() - attemptState.startedAt) / 1000));

  let certEligible = false;
  if (settings.certificateMode === 'all_completions') {
    certEligible = true;
  } else if (settings.certificateMode === 'min_score') {
    certEligible = percentage >= Number(settings.minScorePercentForCert || 50);
  } else {
    certEligible = false;
  }

  const submissionPayload = {
    fullName: candidate.fullName,
    email: candidate.email,
    registerNumber: candidate.registerNumber,
    phone: candidate.phone,
    department: FIXED_DEPARTMENT,
    year: candidate.year,
    college: FIXED_COLLEGE,
    score,
    totalQuestions,
    percentage,
    answeredCount: Object.keys(attemptState.answers).length,
    elapsedSeconds,
    warningsUsed: attemptState.warningsUsed || 0,
    maxWarnings: settings.maxWarnings ?? 2,
    violations: attemptState.violations || [],
    submitReason,
    isAutoSubmitted,
    certificateStatus: certEligible ? 'PROCESSING' : 'MANUAL_APPROVAL_PENDING',
    certificateId: '',
    certificatePdfUrl: '',
    certificateError: '',
    breakdown: detailedBreakdown,
    submittedAt: new Date().toISOString()
  };

  clearAttemptLocal();
  const savedRecord = await recordQuizSubmission(submissionPayload);
  await removeActiveSession(candidate.email, candidate.registerNumber);

  renderResultScreen(savedRecord, false);

  if (certEligible && settings.camsEnabled) {
    const camsResult = await issueCamsCertificate(savedRecord, settings);
    const certPatch = camsResult.ok
      ? {
          certificateStatus: 'SENT',
          certificateId: camsResult.certificateId || '',
          certificatePdfUrl: camsResult.pdfUrl || '',
          certificateSentAt: new Date().toISOString(),
          certificateError: ''
        }
      : {
          certificateStatus: camsResult.status || 'QUEUED_RETRY',
          certificateError: camsResult.message || ''
        };

    await updateSubmissionCertificateStatus(savedRecord.id, certPatch);
    renderCertificateBanner({ ...savedRecord, ...certPatch });
  } else {
    renderCertificateBanner(savedRecord);
  }
}

/* -------------------------------------------------------------------------- */
/* Result View Rendering                                                      */
/* -------------------------------------------------------------------------- */

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

function renderResultScreen(record, isReturningLookup) {
  showScreen('result');

  document.getElementById('result-mode-chip').textContent = isReturningLookup
    ? 'Already Submitted'
    : record.isAutoSubmitted
    ? 'Auto-Submitted'
    : 'Assessment Completed';

  document.getElementById('result-candidate-line').textContent = `${record.fullName} · ${
    record.registerNumber
  } (${record.year || 'EEE'})`;

  const visibility = settings.resultVisibility || 'score_only';
  const scoreSection = document.getElementById('result-score-section');
  if (visibility === 'receipt_only') {
    scoreSection.classList.add('hidden');
  } else {
    scoreSection.classList.remove('hidden');
    document.getElementById('result-score-fraction').textContent = `${record.score}/${record.totalQuestions}`;
    document.getElementById('result-score-percent').textContent = `${record.percentage}% Accuracy`;
  }

  document.getElementById('result-time-taken').textContent = formatDuration(record.elapsedSeconds || 0);
  document.getElementById('result-warnings-used').textContent = `${record.warningsUsed || 0} / ${
    record.maxWarnings ?? 2
  }`;
  document.getElementById('result-submit-type').textContent = record.isAutoSubmitted
    ? 'Auto-Submit'
    : 'Completed';

  const autoAlert = document.getElementById('result-autosubmit-alert');
  if (record.isAutoSubmitted) {
    autoAlert.textContent = record.submitReason || 'Auto-submitted by security proctor.';
    autoAlert.classList.remove('hidden');
  } else {
    autoAlert.classList.add('hidden');
  }

  renderCertificateBanner(record);

  const reviewWrap = document.getElementById('result-answers-review');
  const reviewList = document.getElementById('result-answers-list');
  if (visibility === 'full_answers' && Array.isArray(record.breakdown)) {
    reviewWrap.classList.remove('hidden');
    reviewList.innerHTML = '';
    record.breakdown.forEach((item, i) => {
      const box = document.createElement('div');
      box.style.padding = '12px 14px';
      box.style.borderRadius = '12px';
      box.style.background = '#fbf9ff';
      box.style.border = `1.5px solid ${
        item.isCorrect ? 'rgba(4, 120, 87, 0.35)' : 'rgba(185, 28, 28, 0.35)'
      }`;
      box.innerHTML = `
        <div style="font-size:13.5px; font-weight:700; margin-bottom:6px; color:#1e1035;">Q${i + 1}. ${escapeHtml(
        item.question
      )}</div>
        <div style="font-size:12.5px; color:${item.isCorrect ? '#047857' : '#b91c1c'};">
          Your Answer: <b>${escapeHtml(item.selectedText)}</b> ${item.isCorrect ? '✓' : '✕'}
        </div>
        ${
          !item.isCorrect
            ? `<div style="font-size:12.5px; color:#047857; margin-top:2px;">Correct Answer: <b>${escapeHtml(
                item.correctText
              )}</b></div>`
            : ''
        }
        ${
          item.explanation
            ? `<div style="font-size:12px; color:#4a3869; margin-top:6px;">${escapeHtml(
                item.explanation
              )}</div>`
            : ''
        }
      `;
      reviewList.appendChild(box);
    });
  } else {
    reviewWrap.classList.add('hidden');
  }
}

function renderCertificateBanner(record) {
  const box = document.getElementById('result-cert-box');
  const title = document.getElementById('cert-status-title');
  const desc = document.getElementById('cert-status-desc');
  const idRow = document.getElementById('cert-id-row');
  const idVal = document.getElementById('cert-id-value');
  const verifyBtn = document.getElementById('cert-verify-btn');
  const pdfBtn = document.getElementById('cert-pdf-btn');

  if (record.certificateStatus === 'SENT') {
    box.classList.remove('pending');
    title.style.color = '#047857';
    title.textContent = '✓ CAMS Certificate Generated & Emailed!';
    desc.textContent = `Your signed PDF Certificate of Participation has been sent to ${record.email}. Check your Inbox (and Spam/Promotions tab).`;
    if (record.certificateId) {
      idRow.classList.remove('hidden');
      idVal.textContent = record.certificateId;
      verifyBtn.href = buildVerificationLink(
        settings.camsVerificationUrl || settings.camsWebhookUrl,
        record.certificateId
      );
      if (record.certificatePdfUrl) {
        pdfBtn.href = record.certificatePdfUrl;
        pdfBtn.classList.remove('hidden');
      } else {
        pdfBtn.classList.add('hidden');
      }
    }
    return;
  }

  if (record.certificateStatus === 'PROCESSING') {
    box.classList.add('pending');
    title.style.color = '#b45309';
    title.textContent = '⏳ Generating Your CAMS Certificate...';
    desc.textContent = `Preparing your personalized PDF certificate & QR verification for ${record.email}...`;
    idRow.classList.add('hidden');
    return;
  }

  if (
    settings.certificateMode === 'min_score' &&
    record.percentage < Number(settings.minScorePercentForCert || 50)
  ) {
    box.classList.add('pending');
    title.style.color = '#b91c1c';
    title.textContent = 'Minimum Passing Score Not Reached';
    desc.textContent = `A minimum score of ${settings.minScorePercentForCert}% is required for automatic certificate issuance.`;
    idRow.classList.add('hidden');
    return;
  }

  box.classList.add('pending');
  title.style.color = '#5b21b6';
  title.textContent = '✓ Registered for CAMS Certificate Delivery';
  desc.textContent = `Your completion record is saved! Your signed PDF certificate will be delivered to ${record.email} via the EMBEDX CAMS system.`;
  idRow.classList.add('hidden');
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

initPortal();
