/**
 * @fileoverview Certificate.gs — Idempotent certificate orchestration + automatic
 * Firebase Cloud Firestore verification sync.
 *
 * HOW TO UPDATE IN APPS SCRIPT:
 *   Open Certificate.gs in your CAMS Apps Script editor -> Select All (Ctrl+A) ->
 *   Paste this file -> Save (Ctrl+S).
 */

/** Allocates the next certificate ID under a document lock (strips any trailing slash on prefix). */
function allocateCertificateId_() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(CAMS.LOCK_WAIT_MS)) throw new Error('Could not acquire the certificate-number lock. Try again.');
  try {
    const rawPrefix = getSetting_('Certificate Prefix', true).trim().replace(/\/+$/, '');
    const year = getSetting_('Certificate Year', true).trim();
    const current = Number(getSetting_('Current Running Number') || 0);
    if (!Number.isInteger(current) || current < 0) {
      throw new Error('Current Running Number must be a non-negative integer.');
    }
    const next = current + 1;
    setSetting_('Current Running Number', String(next));
    return rawPrefix + '-' + year + '-' + String(next).padStart(4, '0');
  } finally {
    lock.releaseLock();
  }
}

/**
 * Processes one response row end to end. Safe to re-run:
 * an already-sent row is skipped, and an existing PDF/Slide is reused.
 * Automatically publishes the public verification record to Firebase (`embedx-assessment`).
 * @param {number} row Sheet row number.
 */
function processCertificateRow_(row) {
  const started = Date.now();
  const sheet = requireResponseSheet_();
  let certificate = {};

  try {
    certificate = buildCertificateData_(sheet, row);

    if (getRowValue_(sheet, row, CAMS.HEADERS.MAIL_STATUS) === CAMS.STATUS.SENT) {
      if (typeof syncRowCertificateToFirebase_ === 'function') {
        try { syncRowCertificateToFirebase_(sheet, row); } catch (ignored) {}
      }
      logActivity_({
        action: 'Skipped certificate', studentName: certificate.name, email: certificate.email,
        certificateId: certificate.certificateId, status: CAMS.STATUS.SKIPPED,
        remarks: 'Mail Status is already Sent.', executionTimeMs: Date.now() - started
      });
      return;
    }

    if (!certificate.certificateId) {
      certificate.certificateId = allocateCertificateId_();
      setRowValue_(sheet, row, CAMS.HEADERS.CERTIFICATE_ID, certificate.certificateId);
    }

    setRowValue_(sheet, row, CAMS.HEADERS.MAIL_STATUS, CAMS.STATUS.PROCESSING);
    setRowValue_(sheet, row, CAMS.HEADERS.ERROR, '');

    const pdfName = safeFileName_(formatTemplate_(
      getSetting_('Generated File Name Pattern') || '{{NAME}} - Certificate of Completion.pdf',
      { NAME: certificate.name, CERTIFICATE_ID: certificate.certificateId }
    ));

    let pdfUrl = getRowValue_(sheet, row, CAMS.HEADERS.PDF_URL);
    let pdfFile = null;

    if (pdfUrl) {
      const existingId = extractDriveFileId_(pdfUrl);
      if (existingId) {
        try { pdfFile = DriveApp.getFileById(existingId); } catch (ignored) { pdfFile = null; }
      }
    }

    if (!pdfFile) {
      let slideId = getRowValue_(sheet, row, CAMS.HEADERS.SLIDE_FILE_ID);
      if (!slideId) {
        const slide = createCertificateSlide_(certificate);
        slideId = slide.getId();
        setRowValue_(sheet, row, CAMS.HEADERS.SLIDE_FILE_ID, slideId);
      }
      pdfFile = exportSlideToPdf_(slideId, pdfName);
      pdfUrl = pdfFile.getUrl();
      setRowValue_(sheet, row, CAMS.HEADERS.PDF_URL, pdfUrl);
    }

    sendCertificateEmail_(certificate, pdfFile);
    setRowValue_(sheet, row, CAMS.HEADERS.MAIL_STATUS, CAMS.STATUS.SENT);
    setRowValue_(sheet, row, CAMS.HEADERS.MAIL_SENT_TIME, new Date());
    setRowValue_(sheet, row, CAMS.HEADERS.ERROR, '');

    // Automatically push verified certificate metadata directly to Firebase Firestore!
    if (typeof syncRowCertificateToFirebase_ === 'function') {
      try {
        syncRowCertificateToFirebase_(sheet, row);
      } catch (firebaseErr) {
        Logger.log('Firebase sync warning (non-blocking): ' + firebaseErr.message);
      }
    }

    logActivity_({
      action: 'Generated and emailed certificate', studentName: certificate.name,
      email: certificate.email, certificateId: certificate.certificateId,
      status: CAMS.STATUS.SENT, remarks: pdfUrl, executionTimeMs: Date.now() - started
    });
  } catch (error) {
    try {
      setRowValue_(sheet, row, CAMS.HEADERS.MAIL_STATUS, CAMS.STATUS.FAILED);
      setRowValue_(sheet, row, CAMS.HEADERS.ERROR, error.message || String(error));
    } catch (ignored) { /* row may be gone */ }
    logError_('Process certificate', certificate, error, started);
    throw error;
  }
}

function extractDriveFileId_(url) {
  const match = String(url || '').match(/[-\w]{25,}/);
  return match ? match[0] : '';
}

/** Processes the rows currently selected in the destination spreadsheet. */
function generateSelectedCertificate() {
  getSelectedDataRows_().forEach(row => {
    try { processCertificateRow_(row); } catch (error) { Logger.log(error.message); }
  });
  showToast_('Selected rows processed.');
}

/**
 * Processes every row that is not yet Sent. Blank rows are skipped instead of
 * failing the whole batch, so a half-filled form row cannot stop the run.
 */
function generateAllPending() {
  const sheet = requireResponseSheet_();
  if (sheet.getLastRow() < 2) { showToast_('No response rows to process.'); return; }

  const map = headerMap_(sheet);
  const statusColumn = requireColumn_(map, CAMS.HEADERS.MAIL_STATUS);
  const statuses = sheet.getRange(2, statusColumn, sheet.getLastRow() - 1, 1).getDisplayValues();

  let processed = 0, skipped = 0;

  statuses.forEach((value, index) => {
    const row = index + 2;
    if (value[0] === CAMS.STATUS.SENT) return;
    if (!isCertificateRowProcessable_(sheet, row)) { skipped++; return; }
    try { processCertificateRow_(row); processed++; } catch (error) { Logger.log('Row ' + row + ': ' + error.message); }
  });

  const message = 'Pending rows processed: ' + processed + '. Blank rows skipped: ' + skipped + '.';
  Logger.log(message);
  showToast_(message);
}

/** Retries only the rows whose Mail Status is Failed. */
function resendFailedEmails() {
  const sheet = requireResponseSheet_();
  if (sheet.getLastRow() < 2) { showToast_('No response rows to retry.'); return; }

  const map = headerMap_(sheet);
  const statusColumn = requireColumn_(map, CAMS.HEADERS.MAIL_STATUS);
  const statuses = sheet.getRange(2, statusColumn, sheet.getLastRow() - 1, 1).getDisplayValues();

  statuses.forEach((value, index) => {
    const row = index + 2;
    if (value[0] !== CAMS.STATUS.FAILED) return;
    if (!isCertificateRowProcessable_(sheet, row)) return;
    try { processCertificateRow_(row); } catch (error) { Logger.log('Row ' + row + ': ' + error.message); }
  });
  showToast_('Failed rows retried.');
}

/** Clears automation columns for one row so it can be regenerated from scratch. */
function resetCertificateRow_(row) {
  const sheet = requireResponseSheet_();
  [CAMS.HEADERS.PDF_URL, CAMS.HEADERS.MAIL_SENT_TIME, CAMS.HEADERS.ERROR, CAMS.HEADERS.SLIDE_FILE_ID]
    .forEach(header => setRowValue_(sheet, row, header, ''));
  setRowValue_(sheet, row, CAMS.HEADERS.MAIL_STATUS, '');
}
