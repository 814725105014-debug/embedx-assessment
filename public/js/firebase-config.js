/**
 * Firebase & CAMS Configuration — Connected to `embedx-assessment`
 * EMBEDX | Embedded Systems & Automation Club · Dept. of EEE · SRM TRP Engineering College
 */

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyACO6JtEgvD_n5m5haPV-0y91Z76UI9C18",
  authDomain: "embedx-assessment.firebaseapp.com",
  projectId: "embedx-assessment",
  storageBucket: "embedx-assessment.firebasestorage.app",
  messagingSenderId: "803481654330",
  appId: "1:803481654330:web:3bd07cd5cf42c4de1e5103",
  measurementId: "G-S94VH65XXC"
};

/**
 * Checks whether an admin runtime override exists, otherwise returns live FIREBASE_CONFIG.
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
  // SHA-256 of "Hari@EEE29"
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
  examAccessCode: '',
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
