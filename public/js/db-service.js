/**
 * Unified Data & Authentication Service (Cloud Firestore + Seamless Local Preview Store)
 *
 * - When Firebase API keys are configured in firebase-config.js (or via Admin UI):
 *   Uses Firebase Authentication (strictly locked to 814725105014@trp.srmtrichy.edu.in)
 *   and Cloud Firestore with real-time onSnapshot listeners.
 * - Before Firebase API keys are pasted (Local / Sandbox Preview Mode):
 *   Uses persistent LocalStorage + BroadcastChannel('embedx_live_sync') so Student &
 *   Admin tabs communicate live in real time out of the box!
 */

import {
  ADMIN_ACCESS,
  DEFAULT_PORTAL_SETTINGS,
  getEffectiveFirebaseConfig,
  isFirebaseConfigured
} from './firebase-config.js';
import { DEFAULT_QUESTIONS } from './questions-data.js';

const STORAGE_KEYS = {
  SETTINGS: 'embedx_portal_settings_v1',
  QUESTIONS: 'embedx_questions_bank_v1',
  SUBMISSIONS: 'embedx_submissions_v1',
  ACTIVE_SESSIONS: 'embedx_live_sessions_v1',
  ADMIN_SESSION: 'embedx_admin_auth_session_v1'
};

let firebaseCtx = null;
let initPromise = null;
const broadcast = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('embedx_live_sync') : null;

function notifyLocalChange(topic) {
  if (broadcast) {
    try {
      broadcast.postMessage({ topic, at: Date.now() });
    } catch (_) {
      // ignore
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Pure-JS + WebCrypto SHA-256 (works on both HTTPS and plain HTTP LAN IPs)   */
/* -------------------------------------------------------------------------- */

export async function sha256Hex(message) {
  const text = String(message || '');
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const msgBuffer = new TextEncoder().encode(text);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch (_) {
      // fall through to pure-JS fallback
    }
  }
  return sha256Fallback(text);
}

function sha256Fallback(ascii) {
  const rightRotate = (value, amount) => (value >>> amount) | (value << (32 - amount));
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let result = '';
  const words = [];
  const bytes = new TextEncoder().encode(ascii);
  const asciiBitLength = bytes.length * 8;

  let hash = [];
  const k = [];
  let primeCounter = 0;
  const isComposite = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(asciiBitLength / maxWord), false);
  view.setUint32(padded.length - 4, asciiBitLength >>> 0, false);

  for (let i = 0; i < padded.length; i += 64) {
    const w = new Array(64);
    for (let j = 0; j < 16; j++) w[j] = view.getUint32(i + j * 4, false);
    for (let j = 16; j < 64; j++) {
      const s0 = rightRotate(w[j - 15], 7) ^ rightRotate(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      const s1 = rightRotate(w[j - 2], 17) ^ rightRotate(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let j = 0; j < 64; j++) {
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + k[j] + w[j]) | 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    hash = [
      (hash[0] + a) | 0,
      (hash[1] + b) | 0,
      (hash[2] + c) | 0,
      (hash[3] + d) | 0,
      (hash[4] + e) | 0,
      (hash[5] + f) | 0,
      (hash[6] + g) | 0,
      (hash[7] + h) | 0
    ];
  }
  for (let i = 0; i < 8; i++) {
    result += (hash[i] >>> 0).toString(16).padStart(8, '0');
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* Firebase Lazy Initialization                                               */
/* -------------------------------------------------------------------------- */

export async function initBackend() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const cfg = getEffectiveFirebaseConfig();
    if (!isFirebaseConfigured(cfg)) {
      firebaseCtx = { mode: 'local' };
      return firebaseCtx;
    }
    try {
      const [appMod, authMod, fsMod] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js'),
        import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js')
      ]);
      const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(cfg);
      const auth = authMod.getAuth(app);
      const db = fsMod.getFirestore(app);
      firebaseCtx = { mode: 'firebase', app, auth, db, authMod, fsMod, cfg };
      return firebaseCtx;
    } catch (err) {
      console.warn('Firebase SDK load failed, falling back to local store:', err);
      firebaseCtx = { mode: 'local', error: err?.message };
      return firebaseCtx;
    }
  })();
  return initPromise;
}

export async function getBackendStatus() {
  const ctx = await initBackend();
  return {
    mode: ctx.mode,
    projectId: ctx.cfg?.projectId || null,
    error: ctx.error || null
  };
}

/* -------------------------------------------------------------------------- */
/* Portal Settings                                                            */
/* -------------------------------------------------------------------------- */

function getLocalSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (raw) return { ...DEFAULT_PORTAL_SETTINGS, ...JSON.parse(raw) };
  } catch (_) {}
  return { ...DEFAULT_PORTAL_SETTINGS };
}

export async function loadPortalSettings() {
  const ctx = await initBackend();
  if (ctx.mode === 'firebase') {
    try {
      const { doc, getDoc, setDoc } = ctx.fsMod;
      const ref = doc(ctx.db, 'portal_config', 'main');
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const merged = { ...DEFAULT_PORTAL_SETTINGS, ...snap.data() };
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(merged));
        return merged;
      }
      // Return defaults if doc doesn't exist yet
      return getLocalSettings();
    } catch (err) {
      console.warn('Firestore settings read fallback:', err);
      return getLocalSettings();
    }
  }
  return getLocalSettings();
}

export async function savePortalSettings(partialSettings) {
  const current = await loadPortalSettings();
  const updated = {
    ...current,
    ...partialSettings,
    updatedAt: new Date().toISOString()
  };
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(updated));
  notifyLocalChange('settings');

  const ctx = await initBackend();
  if (ctx.mode === 'firebase') {
    const { doc, setDoc } = ctx.fsMod;
    await setDoc(doc(ctx.db, 'portal_config', 'main'), updated, { merge: true });
  }
  return updated;
}

/* -------------------------------------------------------------------------- */
/* Question Bank                                                              */
/* -------------------------------------------------------------------------- */

function getLocalQuestions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.QUESTIONS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (_) {}
  return DEFAULT_QUESTIONS.map((q) => ({ ...q, options: [...q.options] }));
}

export async function loadQuestions() {
  const ctx = await initBackend();
  if (ctx.mode === 'firebase') {
    try {
      const { doc, getDoc } = ctx.fsMod;
      const snap = await getDoc(doc(ctx.db, 'portal_config', 'questions'));
      if (snap.exists() && Array.isArray(snap.data().items) && snap.data().items.length > 0) {
        localStorage.setItem(STORAGE_KEYS.QUESTIONS, JSON.stringify(snap.data().items));
        return snap.data().items;
      }
    } catch (err) {
      console.warn('Firestore questions read fallback:', err);
    }
  }
  return getLocalQuestions();
}

export async function saveQuestions(questionsArray) {
  localStorage.setItem(STORAGE_KEYS.QUESTIONS, JSON.stringify(questionsArray));
  notifyLocalChange('questions');

  const ctx = await initBackend();
  if (ctx.mode === 'firebase') {
    const { doc, setDoc } = ctx.fsMod;
    await setDoc(doc(ctx.db, 'portal_config', 'questions'), {
      items: questionsArray,
      updatedAt: new Date().toISOString()
    });
  }
  return questionsArray;
}

export async function resetQuestionsToDefault() {
  const fresh = DEFAULT_QUESTIONS.map((q) => ({ ...q, options: [...q.options] }));
  return saveQuestions(fresh);
}

/* -------------------------------------------------------------------------- */
/* Duplicate Attempt Check                                                    */
/* -------------------------------------------------------------------------- */

export function normalizeStudentKey(email, registerNumber) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanReg = String(registerNumber || '').trim().toUpperCase().replace(/\s+/g, '');
  return { cleanEmail, cleanReg, docId: cleanEmail.replace(/[^a-z0-9@._-]/g, '_') };
}

export async function checkExistingSubmission(email, registerNumber) {
  const { cleanEmail, cleanReg, docId } = normalizeStudentKey(email, registerNumber);
  const ctx = await initBackend();

  if (ctx.mode === 'firebase') {
    try {
      const { doc, getDoc } = ctx.fsMod;
      const byEmail = await getDoc(doc(ctx.db, 'submissions', docId));
      if (byEmail.exists() && !byEmail.data().allowRetake) {
        return byEmail.data();
      }
      if (cleanReg) {
        const regSnap = await getDoc(doc(ctx.db, 'reg_locks', cleanReg));
        if (regSnap.exists() && regSnap.data().submissionId) {
          const linkedSub = await getDoc(doc(ctx.db, 'submissions', regSnap.data().submissionId));
          if (linkedSub.exists() && !linkedSub.data().allowRetake) {
            return linkedSub.data();
          }
        }
      }
      return null;
    } catch (_) {
      // fall back to local check
    }
  }

  const list = getLocalSubmissions();
  return (
    list.find(
      (s) =>
        !s.allowRetake &&
        (String(s.email || '').toLowerCase() === cleanEmail ||
          (cleanReg && String(s.registerNumberNormalized || '') === cleanReg))
    ) || null
  );
}

/* -------------------------------------------------------------------------- */
/* Active Live Exam Heartbeat / Proctoring Telemetry                          */
/* -------------------------------------------------------------------------- */

function getLocalActiveSessions() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.ACTIVE_SESSIONS) || '{}') || {};
  } catch (_) {
    return {};
  }
}

export async function upsertActiveSession(sessionData) {
  const { docId } = normalizeStudentKey(sessionData.email, sessionData.registerNumber);
  const payload = {
    ...sessionData,
    sessionId: docId,
    lastUpdatedAt: new Date().toISOString()
  };

  const map = getLocalActiveSessions();
  map[docId] = payload;
  localStorage.setItem(STORAGE_KEYS.ACTIVE_SESSIONS, JSON.stringify(map));
  notifyLocalChange('sessions');

  const ctx = await initBackend();
  if (ctx.mode === 'firebase') {
    try {
      const { doc, setDoc } = ctx.fsMod;
      await setDoc(doc(ctx.db, 'active_sessions', docId), payload, { merge: true });
    } catch (_) {
      // non-blocking telemetry
    }
  }
}

export async function removeActiveSession(email, registerNumber) {
  const { docId } = normalizeStudentKey(email, registerNumber);
  const map = getLocalActiveSessions();
  delete map[docId];
  localStorage.setItem(STORAGE_KEYS.ACTIVE_SESSIONS, JSON.stringify(map));
  notifyLocalChange('sessions');

  const ctx = await initBackend();
  if (ctx.mode === 'firebase') {
    try {
      const { doc, deleteDoc } = ctx.fsMod;
      await deleteDoc(doc(ctx.db, 'active_sessions', docId));
    } catch (_) {}
  }
}

/* -------------------------------------------------------------------------- */
/* Quiz Submissions                                                           */
/* -------------------------------------------------------------------------- */

function getLocalSubmissions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SUBMISSIONS);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
  } catch (_) {}
  return [];
}

function saveLocalSubmissions(list) {
  localStorage.setItem(STORAGE_KEYS.SUBMISSIONS, JSON.stringify(list));
  notifyLocalChange('submissions');
}

export async function recordQuizSubmission(submission) {
  const { cleanEmail, cleanReg, docId } = normalizeStudentKey(
    submission.email,
    submission.registerNumber
  );

  const record = {
    ...submission,
    id: docId,
    email: cleanEmail,
    registerNumberNormalized: cleanReg,
    allowRetake: false,
    submittedAt: submission.submittedAt || new Date().toISOString()
  };

  // Save locally first so data is never lost even offline
  const local = getLocalSubmissions();
  const idx = local.findIndex((item) => item.id === docId);
  if (idx >= 0) local[idx] = record;
  else local.unshift(record);
  saveLocalSubmissions(local);

  // Clean up active live session
  await removeActiveSession(cleanEmail, cleanReg);

  const ctx = await initBackend();
  if (ctx.mode === 'firebase') {
    const { doc, setDoc } = ctx.fsMod;
    await setDoc(doc(ctx.db, 'submissions', docId), record);
    if (cleanReg) {
      try {
        await setDoc(doc(ctx.db, 'reg_locks', cleanReg), {
          submissionId: docId,
          email: cleanEmail,
          createdAt: record.submittedAt
        });
      } catch (_) {}
    }
  }
  return record;
}

export async function updateSubmissionCertificateStatus(submissionId, certUpdate) {
  const local = getLocalSubmissions();
  const idx = local.findIndex((item) => item.id === submissionId);
  if (idx >= 0) {
    local[idx] = { ...local[idx], ...certUpdate };
    saveLocalSubmissions(local);
  }

  const ctx = await initBackend();
  if (ctx.mode === 'firebase') {
    try {
      const { doc, setDoc } = ctx.fsMod;
      await setDoc(doc(ctx.db, 'submissions', submissionId), certUpdate, { merge: true });
    } catch (err) {
      console.warn('Could not sync certificate status to Firestore:', err);
    }
  }
}

export async function allowStudentRetake(submissionId) {
  const existing = getLocalSubmissions().find((item) => item.id === submissionId);
  const local = getLocalSubmissions().filter((item) => item.id !== submissionId);
  saveLocalSubmissions(local);

  const ctx = await initBackend();
  if (ctx.mode === 'firebase') {
    const { doc, getDoc, deleteDoc } = ctx.fsMod;
    try {
      const snap = await getDoc(doc(ctx.db, 'submissions', submissionId));
      const regKey =
        (snap.exists() && snap.data().registerNumberNormalized) ||
        existing?.registerNumberNormalized;
      if (regKey) {
        await deleteDoc(doc(ctx.db, 'reg_locks', regKey)).catch(() => {});
      }
    } catch (_) {}
    await deleteDoc(doc(ctx.db, 'submissions', submissionId));
  }
}

export async function subscribeToAdminData(onData) {
  const ctx = await initBackend();

  if (ctx.mode === 'firebase') {
    const { collection, onSnapshot } = ctx.fsMod;
    let submissions = [];
    let activeSessions = [];

    const emit = () => {
      submissions.sort((a, b) => String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')));
      onData({ submissions, activeSessions, mode: 'firebase' });
    };

    const unsub1 = onSnapshot(collection(ctx.db, 'submissions'), (snap) => {
      submissions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      emit();
    });
    const unsub2 = onSnapshot(collection(ctx.db, 'active_sessions'), (snap) => {
      activeSessions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      emit();
    });

    return () => {
      unsub1();
      unsub2();
    };
  }

  // Local / Preview Real-Time Subscription via BroadcastChannel + storage event
  const pushLocal = () => {
    const submissions = getLocalSubmissions().sort((a, b) =>
      String(b.submittedAt || '').localeCompare(String(a.submittedAt || ''))
    );
    const activeSessions = Object.values(getLocalActiveSessions());
    onData({ submissions, activeSessions, mode: 'local' });
  };

  pushLocal();
  const onStorage = () => pushLocal();
  window.addEventListener('storage', onStorage);
  let onMsg = null;
  if (broadcast) {
    onMsg = () => pushLocal();
    broadcast.addEventListener('message', onMsg);
  }
  const poll = setInterval(pushLocal, 3000);

  return () => {
    window.removeEventListener('storage', onStorage);
    if (broadcast && onMsg) broadcast.removeEventListener('message', onMsg);
    clearInterval(poll);
  };
}

/* -------------------------------------------------------------------------- */
/* Exclusive Admin Authentication (814725105014@trp.srmtrichy.edu.in ONLY)    */
/* -------------------------------------------------------------------------- */

export async function loginAdmin(emailInput, passwordInput) {
  const normalizedEmail = String(emailInput || '').trim().toLowerCase();
  const expectedEmail = ADMIN_ACCESS.allowedEmail.toLowerCase();

  // Hard gate #1: Reject EVERY email except 814725105014@trp.srmtrichy.edu.in
  if (normalizedEmail !== expectedEmail) {
    throw new Error('Access Denied: This login is restricted exclusively to the authorized EMBEDX Administrator.');
  }

  const passHash = await sha256Hex(String(passwordInput || ''));
  const ctx = await initBackend();

  if (ctx.mode === 'firebase') {
    const { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } = ctx.authMod;
    try {
      const cred = await signInWithEmailAndPassword(ctx.auth, expectedEmail, passwordInput);
      if (String(cred.user.email || '').toLowerCase() !== expectedEmail) {
        await signOut(ctx.auth);
        throw new Error('Unauthorized administrator email.');
      }
      sessionStorage.setItem(
        STORAGE_KEYS.ADMIN_SESSION,
        JSON.stringify({ email: expectedEmail, loggedInAt: Date.now(), mode: 'firebase' })
      );
      return { email: expectedEmail, mode: 'firebase' };
    } catch (err) {
      // Auto-bootstrap the single authorized admin user on first login to a brand-new Firebase project
      const code = String(err?.code || '');
      if (
        (code === 'auth/user-not-found' || code === 'auth/invalid-credential') &&
        passHash === ADMIN_ACCESS.passwordSha256
      ) {
        try {
          await createUserWithEmailAndPassword(ctx.auth, expectedEmail, passwordInput);
          sessionStorage.setItem(
            STORAGE_KEYS.ADMIN_SESSION,
            JSON.stringify({ email: expectedEmail, loggedInAt: Date.now(), mode: 'firebase' })
          );
          return { email: expectedEmail, mode: 'firebase', bootstrapped: true };
        } catch (createErr) {
          if (String(createErr?.code || '') === 'auth/email-already-in-use') {
            throw new Error('Invalid administrator password.');
          }
          throw new Error(createErr?.message || 'Firebase Auth configuration required. Enable Email/Password in Firebase Console.');
        }
      }
      throw new Error('Invalid administrator credentials.');
    }
  }

  // Local / Preview Mode Gate
  if (passHash !== ADMIN_ACCESS.passwordSha256) {
    throw new Error('Invalid administrator password.');
  }

  sessionStorage.setItem(
    STORAGE_KEYS.ADMIN_SESSION,
    JSON.stringify({ email: expectedEmail, loggedInAt: Date.now(), mode: 'local' })
  );
  return { email: expectedEmail, mode: 'local' };
}

export async function getActiveAdminSession() {
  const ctx = await initBackend();
  if (ctx.mode === 'firebase' && ctx.auth.currentUser) {
    const email = String(ctx.auth.currentUser.email || '').toLowerCase();
    if (email === ADMIN_ACCESS.allowedEmail.toLowerCase()) {
      return { email, mode: 'firebase' };
    }
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEYS.ADMIN_SESSION);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (String(parsed.email || '').toLowerCase() === ADMIN_ACCESS.allowedEmail.toLowerCase()) {
      return parsed;
    }
  } catch (_) {}
  return null;
}

export async function logoutAdmin() {
  sessionStorage.removeItem(STORAGE_KEYS.ADMIN_SESSION);
  const ctx = await initBackend();
  if (ctx.mode === 'firebase' && ctx.authMod) {
    try {
      await ctx.authMod.signOut(ctx.auth);
    } catch (_) {}
  }
}
