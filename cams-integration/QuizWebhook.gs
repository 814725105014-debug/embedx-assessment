/**
 * @fileoverview QuizWebhook.gs — Connects the EMBEDX Firebase Quiz & Verification
 * Website (`embedx-assessment`) directly to CAMS + syncs issued certificates to
 * Firebase Cloud Firestore so `/verify` works natively on Firebase with ZERO redirects!
 *
 * HOW TO INSTALL / UPDATE IN APPS SCRIPT:
 * 1. Open your CAMS Google Form -> ⋮ -> Script editor.
 * 2. Create or open the Script file named `QuizWebhook` (without .gs).
 * 3. Paste this entire file and press Ctrl+S (Save).
 * 4. Click "Deploy" -> "Manage deployments" -> Pencil (Edit) icon ->
 *    Version: "New version" -> Who has access: "Anyone" -> Click "Deploy".
 */

const CAMS_WEBHOOK_CONFIG = Object.freeze({
  DEFAULT_SECRET: 'EMBEDX-SRMTRP-2026',
  FALLBACK_SPREADSHEET_ID: '1jiVDFpIxGwfSlHBt3vaHl-5GFd8DPGapSS4tsR-FhJQ',
  FIREBASE_PROJECT_ID: 'embedx-assessment',
  FIREBASE_WEB_API_KEY: 'AIzaSyACO6JtEgvD_n5m5haPV-0y91Z76UI9C18',
  FIREBASE_VERIFY_BASE_URL: 'https://embedx-assessment.web.app/verify'
});

/**
 * Ensures Web App executions (doPost / doGet) can always resolve the response
 * spreadsheet even before initializeSystem() is re-run.
 */
function ensureWebAppSpreadsheetBinding_() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('RESPONSE_SPREADSHEET_ID')) {
    props.setProperty('RESPONSE_SPREADSHEET_ID', CAMS_WEBHOOK_CONFIG.FALLBACK_SPREADSHEET_ID);
  }
}

/**
 * Deterministic Firestore document key for a Certificate ID (replaces `/` with `_`).
 * Matches `certIdToDocKey()` in the Firebase web app (`db-service.js`).
 * Example: "EEE/EMBX-2026-0004" -> "EEE_EMBX-2026-0004"
 * @param {string} certificateId
 * @return {string}
 */
function certIdToFirestoreDocKey_(certificateId) {
  return String(certificateId || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9_-]/g, '_');
}

/**
 * Pushes a public-safe certificate verification record directly to Firebase Cloud Firestore
 * (`projects/embedx-assessment/databases/(default)/documents/certificates/{docKey}`).
 * Never uploads private student email, phone number, or PDF URL to the public verification doc.
 * @param {!Object} record
 * @return {boolean}
 */
function syncCertificateObjectToFirebase_(record) {
  const certId = String(record.certificateId || '').trim();
  if (!certId) return false;

  const docKey = certIdToFirestoreDocKey_(certId);
  const url =
    'https://firestore.googleapis.com/v1/projects/' +
    encodeURIComponent(CAMS_WEBHOOK_CONFIG.FIREBASE_PROJECT_ID) +
    '/databases/(default)/documents/certificates/' +
    encodeURIComponent(docKey) +
    '?key=' +
    encodeURIComponent(CAMS_WEBHOOK_CONFIG.FIREBASE_WEB_API_KEY);

  const strField = val => ({ stringValue: String(val === undefined || val === null ? '' : val) });

  const firestoreDoc = {
    fields: {
      certificateId: strField(certId),
      status: strField('VALID'),
      name: strField(record.name || ''),
      registerNumber: strField(record.registerNumber || ''),
      department: strField(record.department || 'EEE'),
      year: strField(record.year || ''),
      workshop: strField(record.workshop || record.courseName || ''),
      courseName: strField(record.courseName || ''),
      conductedBy: strField(record.conductedBy || 'EMBEDX | Embedded Systems & Automation Club'),
      duration: strField(record.duration || '1 Day'),
      issueDate: strField(record.issueDate || ''),
      organization: strField(record.organization || 'SRM TRP Engineering College'),
      verificationUrl: strField(
        CAMS_WEBHOOK_CONFIG.FIREBASE_VERIFY_BASE_URL + '?certificateId=' + encodeURIComponent(certId)
      ),
      syncedAt: strField(new Date().toISOString())
    }
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'patch',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify(firestoreDoc),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  if (code >= 200 && code < 300) {
    Logger.log('Synced certificate ' + certId + ' -> Firebase Firestore (' + docKey + ')');
    return true;
  }

  Logger.log('Firebase Firestore sync HTTP ' + code + ': ' + response.getContentText().slice(0, 300));
  return false;
}

/**
 * Reads a Sent row from the response sheet and syncs its public verification data to Firebase.
 * Automatically invoked by Certificate.gs (`processCertificateRow_`) for Form & Quiz rows alike!
 * @param {!GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} row
 * @return {boolean}
 */
function syncRowCertificateToFirebase_(sheet, row) {
  const map = headerMap_(sheet);
  const values = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];

  const readByCandidates = candidates => {
    for (let i = 0; i < candidates.length; i++) {
      if (!candidates[i]) continue;
      const col = map[normalizeKey_(candidates[i])];
      if (col) return String(values[col - 1] || '').trim();
    }
    return '';
  };

  const mailStatus = readByCandidates([CAMS.HEADERS.MAIL_STATUS]);
  const certId = readByCandidates([CAMS.HEADERS.CERTIFICATE_ID]);
  if (!certId || mailStatus !== CAMS.STATUS.SENT) return false;

  const sentTime = readByCandidates([CAMS.HEADERS.MAIL_SENT_TIME]);
  const issueDate = readByCandidates(['Issue Date']) || sentTime || formatIssueDate_(new Date());

  return syncCertificateObjectToFirebase_({
    certificateId: certId,
    name: readByCandidates([getSetting_('Name Field Header'), 'Participant Full Name', 'Full Name', 'Name']),
    registerNumber: readByCandidates(['Register Number', 'Reg No', 'Roll Number']),
    department: readByCandidates(['Department', 'Dept']) || 'EEE',
    year: readByCandidates(['Year of Study', 'Year']),
    workshop: readByCandidates(['Workshop', getSetting_('Course Name Field Header')]),
    courseName: readByCandidates([getSetting_('Course Name Field Header'), 'Course Name', 'Workshop']),
    conductedBy: readByCandidates(['Conducted By']) || 'EMBEDX | Embedded Systems & Automation Club',
    duration: readByCandidates([getSetting_('Duration Field Header'), 'Course Duration', 'Duration']) ||
      getSetting_('Default Duration') || '1 Day',
    issueDate: issueDate,
    organization: getSetting_('Organization Name') || 'SRM TRP Engineering College'
  });
}

/**
 * ONE-CLICK ADMIN HELPER: Run `syncAllCertificatesToFirebase` from the Apps Script toolbar
 * to push ALL already-sent rows in 'Form Responses 1' into Firebase Cloud Firestore!
 */
function syncAllCertificatesToFirebase() {
  ensureWebAppSpreadsheetBinding_();
  const sheet = requireResponseSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('No certificate rows to sync.');
    return;
  }
  let synced = 0;
  for (let row = 2; row <= lastRow; row++) {
    try {
      if (syncRowCertificateToFirebase_(sheet, row)) synced++;
    } catch (err) {
      Logger.log('Row ' + row + ' sync error: ' + err.message);
    }
  }
  Logger.log('Synced ' + synced + ' Sent certificate(s) to Firebase Firestore.');
}

/**
 * JSON HTTP response helper for Web App POST calls.
 * @param {!Object} payload
 * @return {!ContentService.TextOutput}
 */
function jsonWebhookResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Validates the shared webhook secret against Settings ('Webhook Secret') or default.
 * @param {string} providedSecret
 */
function verifyWebhookSecret_(providedSecret) {
  let expected = '';
  try {
    expected = String(getSetting_('Webhook Secret') || '').trim();
  } catch (ignored) {
    expected = '';
  }
  if (!expected) expected = CAMS_WEBHOOK_CONFIG.DEFAULT_SECRET;
  if (String(providedSecret || '').trim() !== expected) {
    throw new Error('Unauthorized webhook request: invalid CAMS API Secret.');
  }
}

/**
 * Google Apps Script Web App POST Entry Point.
 * Supports:
 *   - action: "verify"           (Public JSON certificate verification fallback — no secret needed)
 *   - action: "ping"             (Admin health check — requires apiSecret)
 *   - action: "issueCertificate" (Issues PDF + QR pointing to Firebase + Emails + Syncs Firestore)
 * @param {!Object} e
 * @return {!ContentService.TextOutput}
 */
function doPost(e) {
  const started = Date.now();
  try {
    ensureWebAppSpreadsheetBinding_();

    if (!e || !e.postData || !e.postData.contents) {
      return jsonWebhookResponse_({ ok: false, error: 'Empty POST body.' });
    }

    const body = JSON.parse(e.postData.contents);
    const action = String(body.action || '').trim();

    // Public read-only certificate verification fallback (used silently by Firebase /verify)
    if (action === 'verify') {
      const certId = String(body.certificateId || '').trim();
      if (!certId) return jsonWebhookResponse_({ status: 'EMPTY', certificateId: '' });
      const res = verifyCertificate_(certId);
      return jsonWebhookResponse_(res);
    }

    // All write/admin actions require shared webhook secret
    verifyWebhookSecret_(body.apiSecret);

    // 1. Health Check Ping from Quiz Admin Dashboard
    if (action === 'ping') {
      const sheet = requireResponseSheet_();
      return jsonWebhookResponse_({
        ok: true,
        sheetName: sheet.getName(),
        organization: getSetting_('Organization Name'),
        prefix: getSetting_('Certificate Prefix'),
        qrVerifyBaseUrl: normalizeQrBaseUrl_(getSetting_('QR Verification Base URL')),
        lastRow: sheet.getLastRow()
      });
    }

    // 2. Issue & Email Certificate via CAMS Pipeline
    if (action === 'issueCertificate') {
      const p = body.participant || {};
      const email = String(p.email || '').trim().toLowerCase();
      const name = String(p.name || '').trim();
      const workshop = String(
        p.workshop || 'Basics of Embedded Systems and Embedded Programming Language'
      ).trim();

      if (!name || !email) {
        return jsonWebhookResponse_({ ok: false, error: 'Participant name and email are required.' });
      }

      const lock = LockService.getScriptLock();
      if (!lock.tryLock(30000)) {
        return jsonWebhookResponse_({
          ok: false,
          error: 'Server busy issuing other certificates. Please retry in a few seconds.'
        });
      }

      let targetRow = 0;
      try {
        // Ensure QR Verification Base URL in Settings always points to Firebase before generating QR
        const currentQrBase = String(getSetting_('QR Verification Base URL') || '').trim();
        if (!currentQrBase || /script\.google\.com/i.test(currentQrBase)) {
          setSetting_('QR Verification Base URL', CAMS_WEBHOOK_CONFIG.FIREBASE_VERIFY_BASE_URL);
        }

        const sheet = requireResponseSheet_();
        ensureAutomationColumns_(sheet);
        const map = headerMap_(sheet);

        const emailCol = map[normalizeKey_(getSetting_('Email Field Header') || 'Email Address')];
        const statusCol = map[normalizeKey_(CAMS.HEADERS.MAIL_STATUS)];
        const certIdCol = map[normalizeKey_(CAMS.HEADERS.CERTIFICATE_ID)];
        const pdfUrlCol = map[normalizeKey_(CAMS.HEADERS.PDF_URL)];

        if (emailCol && sheet.getLastRow() >= 2) {
          const allRows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getDisplayValues();
          for (let i = allRows.length - 1; i >= 0; i--) {
            const rowEmail = String(allRows[i][emailCol - 1] || '').trim().toLowerCase();
            if (rowEmail === email) {
              const existingStatus = statusCol ? String(allRows[i][statusCol - 1] || '').trim() : '';
              const existingId = certIdCol ? String(allRows[i][certIdCol - 1] || '').trim() : '';
              const existingPdf = pdfUrlCol ? String(allRows[i][pdfUrlCol - 1] || '').trim() : '';

              if (existingStatus === CAMS.STATUS.SENT && existingId) {
                try { syncRowCertificateToFirebase_(sheet, i + 2); } catch (ignored) {}
                return jsonWebhookResponse_({
                  ok: true,
                  status: 'SENT',
                  certificateId: existingId,
                  pdfUrl: existingPdf,
                  verificationUrl:
                    CAMS_WEBHOOK_CONFIG.FIREBASE_VERIFY_BASE_URL +
                    '?certificateId=' +
                    encodeURIComponent(existingId),
                  message: 'Certificate was already generated and sent for this email.'
                });
              }
              targetRow = i + 2;
              break;
            }
          }
        }

        if (!targetRow) {
          const totalCols = Math.max(sheet.getLastColumn(), 1);
          const newRowValues = new Array(totalCols).fill('');

          const putByCandidates = (candidates, val) => {
            if (val === undefined || val === null || val === '') return;
            for (let c = 0; c < candidates.length; c++) {
              if (!candidates[c]) continue;
              const colIdx = map[normalizeKey_(candidates[c])];
              if (colIdx) {
                newRowValues[colIdx - 1] = val;
                return;
              }
            }
          };

          const now = new Date();
          putByCandidates(['Timestamp'], now);
          putByCandidates([getSetting_('Email Field Header'), 'Email Address', 'Email'], email);
          putByCandidates([getSetting_('Name Field Header'), 'Participant Full Name', 'Full Name', 'Name'], name);
          putByCandidates(['Register Number', 'Roll Number', 'Reg No'], p.registerNumber || '');
          putByCandidates(['Mobile Number', 'Phone Number', 'Mobile', 'WhatsApp Number'], p.phone || '');
          putByCandidates(['Year of Study', 'Year'], p.year || '');
          putByCandidates(['Workshop', getSetting_('Course Name Field Header')], workshop);
          putByCandidates(['Department', 'Dept'], p.department || 'EEE');
          putByCandidates(['Course Name'], p.courseName || workshop);
          putByCandidates(['Conducted By'], p.conductedBy || 'EMBEDX | Embedded Systems & Automation Club');
          putByCandidates([getSetting_('Duration Field Header'), 'Course Duration', 'Duration'], p.duration || '1 Day');
          putByCandidates(['Issue Date'], formatIssueDate_(now));
          putByCandidates([CAMS.HEADERS.MAIL_STATUS], CAMS.STATUS.PENDING);

          sheet.appendRow(newRowValues);
          SpreadsheetApp.flush();
          targetRow = sheet.getLastRow();
        }
      } finally {
        lock.releaseLock();
      }

      // Run full CAMS pipeline: Certificate ID -> Slides Copy -> Signatures -> Firebase QR -> PDF -> Gmail -> Firestore Sync!
      processCertificateRow_(targetRow);

      const sheetAfter = requireResponseSheet_();
      const issuedId = getRowValue_(sheetAfter, targetRow, CAMS.HEADERS.CERTIFICATE_ID);
      const issuedPdf = getRowValue_(sheetAfter, targetRow, CAMS.HEADERS.PDF_URL);
      try { syncRowCertificateToFirebase_(sheetAfter, targetRow); } catch (ignored) {}

      return jsonWebhookResponse_({
        ok: true,
        status: 'SENT',
        certificateId: issuedId,
        pdfUrl: issuedPdf,
        verificationUrl:
          CAMS_WEBHOOK_CONFIG.FIREBASE_VERIFY_BASE_URL +
          '?certificateId=' +
          encodeURIComponent(issuedId),
        executionMs: Date.now() - started,
        message: 'Certificate generated with Firebase QR link and emailed via CAMS.'
      });
    }

    return jsonWebhookResponse_({ ok: false, error: 'Unsupported action: ' + action });
  } catch (error) {
    try {
      logError_('Quiz Website Webhook (doPost)', {}, error, started);
    } catch (ignored) {}
    return jsonWebhookResponse_({
      ok: false,
      error: error && error.message ? error.message : String(error)
    });
  }
}
