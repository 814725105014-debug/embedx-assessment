/**
 * @fileoverview QuizWebhook.gs — Connects the EMBEDX Firebase Quiz Website
 * directly to CAMS (Certificate Automation Management System).
 *
 * HOW TO INSTALL IN YOUR EXISTING CAMS APPS SCRIPT PROJECT (2 MINUTES):
 * 1. Open your Google Form -> ⋮ -> Script editor (your existing CAMS project).
 * 2. Click "+" next to Files -> Script -> name it "QuizWebhook" (without .gs).
 * 3. Paste this entire file and press Ctrl+S (Save).
 * 4. Click "Deploy" -> "Manage deployments" -> Pencil (Edit) icon ->
 *    Version: "New version" -> Who has access: "Anyone" -> Click "Deploy".
 * 5. Copy the /exec Web App URL into the EMBEDX Quiz Admin Panel -> CAMS tab!
 */

const CAMS_WEBHOOK_CONFIG = Object.freeze({
  DEFAULT_SECRET: 'EMBEDX-SRMTRP-2026',
  FALLBACK_SPREADSHEET_ID: '1jiVDFpIxGwfSlHBt3vaHl-5GFd8DPGapSS4tsR-FhJQ'
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
 * Triggered automatically when a student completes the EMBEDX Quiz (or from Admin Panel).
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
    verifyWebhookSecret_(body.apiSecret);

    const action = String(body.action || '').trim();

    // 1. Health Check Ping from Quiz Admin Dashboard
    if (action === 'ping') {
      const sheet = requireResponseSheet_();
      return jsonWebhookResponse_({
        ok: true,
        sheetName: sheet.getName(),
        organization: getSetting_('Organization Name'),
        prefix: getSetting_('Certificate Prefix'),
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

      // Acquire script lock so concurrent student quiz submissions never collide on row numbers
      const lock = LockService.getScriptLock();
      if (!lock.tryLock(30000)) {
        return jsonWebhookResponse_({
          ok: false,
          error: 'Server busy issuing other certificates. Please retry in a few seconds.'
        });
      }

      let targetRow = 0;
      try {
        const sheet = requireResponseSheet_();
        ensureAutomationColumns_(sheet);
        const map = headerMap_(sheet);

        // Idempotency Check: Reuse existing row if this email already exists in the sheet
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
                return jsonWebhookResponse_({
                  ok: true,
                  status: 'SENT',
                  certificateId: existingId,
                  pdfUrl: existingPdf,
                  message: 'Certificate was already generated and sent for this email.'
                });
              }
              targetRow = i + 2;
              break;
            }
          }
        }

        // Append a new participant row if not already present
        if (!targetRow) {
          const totalCols = Math.max(sheet.getLastColumn(), 1);
          const newRowValues = new Array(totalCols).fill('');

          const putByCandidates = (candidates, val) => {
            if (val === undefined || val === null || val === '') return;
            for (let c = 0; c < candidates.length; c++) {
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
          putByCandidates([getSetting_('Course Name Field Header'), 'Workshop'], workshop);
          putByCandidates(['Department', 'Dept'], p.department || '');
          putByCandidates(['Course Name'], p.courseName || workshop);
          putByCandidates(['Conducted By'], p.conductedBy || 'EMBEDX CLUB');
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

      // Run full CAMS pipeline: Certificate ID -> Slides Copy -> Signatures -> QR -> PDF -> Gmail!
      processCertificateRow_(targetRow);

      const sheetAfter = requireResponseSheet_();
      const issuedId = getRowValue_(sheetAfter, targetRow, CAMS.HEADERS.CERTIFICATE_ID);
      const issuedPdf = getRowValue_(sheetAfter, targetRow, CAMS.HEADERS.PDF_URL);

      return jsonWebhookResponse_({
        ok: true,
        status: 'SENT',
        certificateId: issuedId,
        pdfUrl: issuedPdf,
        executionMs: Date.now() - started,
        message: 'Certificate generated and emailed via CAMS.'
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
