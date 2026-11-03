/**
 * Firebase & CAMS Configuration
 *
 * HOW TO ACTIVATE LIVE FIREBASE CLOUD MODE:
 * 1. Create a project at https://console.firebase.google.com
 * 2. Enable Authentication -> Email/Password
 * 3. Enable Cloud Firestore -> Start in production mode (deploy firestore.rules)
 * 4. Add a Web App (</>) in Project Settings and paste your firebaseConfig values below
 *    (or paste them directly inside the Admin Dashboard -> Settings -> Firebase Config!)
 */

export const FIREBASE_CONFIG = {
  apiKey: "REPLACE_WITH_FIREBASE_API_KEY",
  authDomain: "REPLACE_WITH_PROJECT_ID.firebaseapp.com",
  projectId: "REPLACE_WITH_PROJECT_ID",
  storageBucket: "REPLACE_WITH_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "REPLACE_WITH_SENDER_ID",
  appId: "REPLACE_WITH_APP_ID"
};

/**
 * Checks whether Firebase config has been populated (either in this file or saved via Admin UI).
 */
export function getEffectiveFirebaseConfig() {
  try {
    const saved = localStorage.getItem('embedx_firebase_config_override');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.apiKey && !String(parsed.apiKey).startsWith('REPLACE_WITH_')) {
        return parsed;
      }
    }
  } catch (_) {
    // ignore storage errors
  }
  return FIREBASE_CONFIG;
}

export function isFirebaseConfigured(cfg = getEffectiveFirebaseConfig()) {
  return Boolean(
    cfg &&
    cfg.apiKey &&
    cfg.projectId &&
    !String(cfg.apiKey).startsWith('REPLACE_WITH_') &&
    !String(cfg.projectId).startsWith('REPLACE_WITH_')
  );
}

/**
 * Exclusive Admin Credentials Policy
 * Enforced in client auth gate, Firebase Auth bootstrap, AND Firestore Security Rules.
 */
export const ADMIN_ACCESS = Object.freeze({
  allowedEmail: '814725105014@trp.srmtrichy.edu.in',
  // SHA-256 of "Hari@EEE29" for local/preview gate verification; Firebase Auth enforces server-side in cloud mode
  passwordSha256: '02ec78533da916a8a24392b408d3a32aa4a5d766bf5632b40f08a5d230c4f920'
});

/**
 * Default Portal & CAMS Certificate Settings
 * Pre-configured for SRM TRP Engineering College — EMBEDX Club (Dept. of EEE)
 * Matched to CAMS Spreadsheet: 1jiVDFpIxGwfSlHBt3vaHl-5GFd8DPGapSS4tsR-FhJQ
 */
export const DEFAULT_PORTAL_SETTINGS = {
  quizOpen: true,
  quizTitle: 'EMBEDX Workshop Quiz',
  workshopName: 'Basics of Embedded Systems and Embedded Programming Language',
  courseDuration: '1 Day',
  conductedBy: 'EMBEDX | Embedded Systems & Automation Club',
  organizationName: 'SRM TRP Engineering College · Dept. of EEE',
  durationMinutes: 30,
  maxWarnings: 2,
  returnGraceSeconds: 20,
  shuffleQuestions: true,
  shuffleOptions: true,
  requireFullscreen: true,
  canvasAntiSearch: true,
  watermarkRegNo: true,
  allowDuplicateEmail: false,
  examAccessCode: '', // optional live hall PIN if admin sets one
  // Student post-submit display: 'score_only' | 'receipt_only' | 'full_answers'
  resultVisibility: 'score_only',
  // Certificate policy: 'all_completions' | 'min_score' | 'manual_only'
  certificateMode: 'all_completions',
  minScorePercentForCert: 0,
  // CAMS Google Apps Script Web App integration
  camsEnabled: true,
  camsWebhookUrl:
    'https://script.google.com/macros/s/AKfycbxQcAOxGv7alzmzSCwlXet5EeUA2_vXGBsLcUk6GPN1WEwX5LdLYgyNMcoJgOS1tXNe/exec',
  camsVerificationUrl:
    'https://script.google.com/macros/s/AKfycbxQcAOxGv7alzmzSCwlXet5EeUA2_vXGBsLcUk6GPN1WEwX5LdLYgyNMcoJgOS1tXNe/exec',
  camsApiSecret: 'EMBEDX-SRMTRP-2026',
  collegeLogoDriveId: '1FEmwo2vGwZA4h_Os0kBBm5ad3eiCRBal'
};
