/**
 * @fileoverview Verification.gs — Public JSON Verification API + Direct Firebase QR Sync.
 *
 * HOW TO UPDATE IN APPS SCRIPT:
 *   Open Verification.gs in your CAMS Apps Script editor -> Select All (Ctrl+A) ->
 *   Paste this file -> Save (Ctrl+S).
 *
 * KEY FIXES:
 * 1. syncVerificationUrlSetting() now writes https://embedx-assessment.web.app/verify
 *    into Settings -> QR Verification Base URL (NEVER script.google.com or /macros/u/5/).
 * 2. doGet(e) supports ?format=json&certificateId=... so the Firebase /verify page
 *    can silently verify any Google Sheet row via anonymous CORS JSON fetch without
 *    ever redirecting the user to Apps Script!
 */

const FIREBASE_PUBLIC_VERIFY_URL = 'https://embedx-assessment.web.app/verify';
const FALLBACK_RESPONSE_SPREADSHEET_ID = '1jiVDFpIxGwfSlHBt3vaHl-5GFd8DPGapSS4tsR-FhJQ';

/**
 * Ensures Web App executions can always locate the CAMS response spreadsheet.
 */
function ensureVerificationSpreadsheetBinding_() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('RESPONSE_SPREADSHEET_ID')) {
    props.setProperty('RESPONSE_SPREADSHEET_ID', FALLBACK_RESPONSE_SPREADSHEET_ID);
  }
}

/**
 * Normalizes a Certificate ID for flexible lookup (handles spaces, case, and
 * legacy trailing-slash prefixes such as EEE/EMBX/-2026-0002 vs EEE/EMBX-2026-0002).
 * @param {string} id
 * @return {string}
 */
function normalizeCertCompareKey_(id) {
  return String(id || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/\/-/g, '-');
}

/**
 * Web App GET entry point.
 * - When called by Firebase (/verify) with ?format=json&certificateId=..., returns
 *   clean JSON directly (NO HTML, NO browser redirect, NO Google multi-account /u/5/ issue).
 * - When visited directly in a browser, renders Verification.html if present.
 * @param {!Object} e
 * @return {!ContentService.TextOutput|!HtmlOutput}
 */
function doGet(e) {
  ensureVerificationSpreadsheetBinding_();

  const params = (e && e.parameter) || {};
  const certificateId = String(params.certificateId || params.id || '').trim();
  const format = String(params.format || '').trim().toLowerCase();
  const action = String(params.action || '').trim().toLowerCase();

  // Direct JSON API used silently by https://embedx-assessment.web.app/verify
  if (format === 'json' || action === 'verify') {
    const payload = certificateId
      ? verifyCertificate_(certificateId)
      : { status: 'EMPTY', certificateId: '' };
    return ContentService.createTextOutput(JSON.stringify(payload))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const template = HtmlService.createTemplateFromFile('Verification');
  template.pageTitle = getSetting_('Verification Page Title') || 'Certificate Verification';
  template.logoDataUri = getCollegeLogoDataUri_();
  template.collegeName = getSetting_('Organization Name') || getSetting_('College Name') || '';
  template.collegeSubtitle = getSetting_('College Subtitle') || '';
  template.searchedId = certificateId;
  template.result = certificateId ? verifyCertificate_(certificateId) : { status: 'EMPTY', certificateId: '' };

  return template.evaluate()
    .setTitle(template.pageTitle)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Looks up a certificate in the response sheet and returns ONLY public verification fields.
 * Never exposes email address, mobile number, or private Drive links.
 * @param {string} certificateId
 * @return {!Object}
 */
function verifyCertificate_(certificateId) {
  try {
    ensureVerificationSpreadsheetBinding_();
    const sheet = requireResponseSheet_();
    const map = headerMap_(sheet);
    const idColumn = requireColumn_(map, CAMS.HEADERS.CERTIFICATE_ID);
    const statusColumn = requireColumn_(map, CAMS.HEADERS.MAIL_STATUS);
    const sentColumn = requireColumn_(map, CAMS.HEADERS.MAIL_SENT_TIME);
    const lastRow = sheet.getLastRow();

    if (lastRow < 2) return { status: 'NOT_FOUND', certificateId: certificateId };

    const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getDisplayValues();
    const wantedExact = String(certificateId || '').trim().replace(/\s+/g, '').toUpperCase();
    const wantedFlex = normalizeCertCompareKey_(certificateId);

    const resolveCol = candidates => {
      for (let c = 0; c < candidates.length; c++) {
        if (!candidates[c]) continue;
        const idx = map[normalizeKey_(candidates[c])];
        if (idx) return idx;
      }
      return 0;
    };

    const colName = resolveCol([getSetting_('Name Field Header'), 'Participant Full Name', 'Full Name', 'Name']);
    const colRegNo = resolveCol(['Register Number', 'Reg No', 'Roll Number']);
    const colYear = resolveCol(['Year of Study', 'Year']);
    const colDept = resolveCol(['Department', 'Dept']);
    const colWorkshop = resolveCol(['Workshop', getSetting_('Course Name Field Header')]);
    const colCourse = resolveCol([getSetting_('Course Name Field Header'), 'Course Name', 'Workshop']);
    const colConducted = resolveCol(['Conducted By']);
    const colDuration = resolveCol([getSetting_('Duration Field Header'), 'Course Duration', 'Duration']);
    const colIssueDate = resolveCol(['Issue Date']);

    const readCol = (rowArr, colIdx) => (colIdx ? String(rowArr[colIdx - 1] || '').trim() : '');

    for (let i = 0; i < values.length; i++) {
      const rawRowId = String(values[i][idColumn - 1] || '').trim();
      if (!rawRowId) continue;

      const rowExact = rawRowId.replace(/\s+/g, '').toUpperCase();
      const rowFlex = normalizeCertCompareKey_(rawRowId);
      if (rowExact !== wantedExact && rowFlex !== wantedFlex) continue;

      const mailStatus = String(values[i][statusColumn - 1] || '').trim();
      const sentOn = String(values[i][sentColumn - 1] || '').trim();
      const issueDate = readCol(values[i], colIssueDate) || sentOn;

      if (mailStatus !== CAMS.STATUS.SENT) {
        return {
          status: 'NOT_ISSUED',
          certificateId: rawRowId,
          mailStatus: mailStatus || 'Pending',
          name: readCol(values[i], colName),
          organization: getSetting_('Organization Name') || 'SRM TRP Engineering College'
        };
      }

      return {
        status: 'VALID',
        certificateId: rawRowId,
        name: readCol(values[i], colName),
        registerNumber: readCol(values[i], colRegNo),
        year: readCol(values[i], colYear),
        department: readCol(values[i], colDept) || 'EEE',
        workshop: readCol(values[i], colWorkshop),
        courseName: readCol(values[i], colCourse),
        conductedBy: readCol(values[i], colConducted) || 'EMBEDX | Embedded Systems & Automation Club',
        duration: readCol(values[i], colDuration) || getSetting_('Default Duration') || '1 Day',
        issueDate: issueDate,
        organization: getSetting_('Organization Name') || 'SRM TRP Engineering College',
        verifiedAt: formatDateTime_(new Date())
      };
    }

    return { status: 'NOT_FOUND', certificateId: certificateId };
  } catch (error) {
    Logger.log('Verification failed: ' + error.message);
    return { status: 'ERROR', certificateId: certificateId, message: error.message };
  }
}

/**
 * Returns the canonical public Firebase Verification URL (never /macros/u/5/).
 */
function getWebAppUrl() {
  return FIREBASE_PUBLIC_VERIFY_URL;
}

/**
 * Writes the direct Firebase Verification URL into Settings -> QR Verification Base URL.
 * Safe to run from any Google account without ever writing /macros/u/5/ into Settings!
 */
function syncVerificationUrlSetting() {
  setSetting_('QR Verification Base URL', FIREBASE_PUBLIC_VERIFY_URL);
  setSetting_('QR Data Mode', 'VERIFICATION_URL');
  Logger.log('QR Verification Base URL set to Firebase: ' + getSetting_('QR Verification Base URL'));
  return getSetting_('QR Verification Base URL');
}
