/**
 * CAMS (Certificate Automation Management System) Client Bridge
 *
 * - Triggers backend PDF + Firebase-QR + Gmail delivery via QuizWebhook.gs (doPost)
 * - Generates direct Firebase verification links (`/verify?certificateId=...`) — NEVER Apps Script URLs
 * - Provides silent JSON API lookup (`credentials: 'omit'`) as a background fallback for `/verify`
 *   with ZERO browser redirects and ZERO Google `/u/5/` multi-account routing issues!
 */

import { OFFICIAL_FIREBASE_VERIFY_URL } from './firebase-config.js';

export async function issueCamsCertificate(submission, settings) {
  const webhookUrl = sanitizeAppsScriptEndpoint(settings?.camsWebhookUrl);
  if (!settings?.camsEnabled || !webhookUrl) {
    return {
      ok: false,
      status: 'DISABLED',
      message: 'CAMS auto-certificate webhook is disabled or URL is empty.'
    };
  }

  const payload = {
    action: 'issueCertificate',
    apiSecret: String(settings.camsApiSecret || '').trim(),
    participant: {
      email: String(submission.email || '').trim().toLowerCase(),
      name: String(submission.fullName || '').trim(),
      registerNumber: String(submission.registerNumber || '').trim(),
      department: String(submission.department || 'EEE').trim(),
      year: String(submission.year || '').trim(),
      college: String(submission.college || 'SRM TRP Engineering College').trim(),
      phone: String(submission.phone || '').trim(),
      workshop: String(
        settings.workshopName || 'Basics of Embedded Systems and Embedded Programming Language'
      ).trim(),
      courseName: String(settings.quizTitle || 'EMBEDX Workshop Quiz').trim(),
      conductedBy: String(
        settings.conductedBy || 'EMBEDX | Embedded Systems & Automation Club'
      ).trim(),
      duration: String(settings.courseDuration || '1 Day').trim(),
      score: Number(submission.score || 0),
      totalQuestions: Number(submission.totalQuestions || 30),
      percentage: Number(submission.percentage || 0),
      submitReason: String(submission.submitReason || 'Manual Submit')
    }
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const rawText = await response.text();
    let parsed = null;
    try {
      parsed = JSON.parse(rawText);
    } catch (_) {
      parsed = null;
    }

    if (parsed && parsed.ok) {
      return {
        ok: true,
        status: parsed.status || 'SENT',
        certificateId: parsed.certificateId || '',
        pdfUrl: parsed.pdfUrl || '',
        verificationUrl: buildCanonicalFirebaseVerifyLink(parsed.certificateId),
        message: parsed.message || 'Certificate generated with Firebase QR and emailed via CAMS.'
      };
    }

    if (
      rawText.includes('Script function not found: doPost') ||
      rawText.includes('Page Not Found') ||
      response.status === 404 ||
      response.status === 405
    ) {
      return {
        ok: false,
        status: 'QUEUED_WEBHOOK_SETUP_NEEDED',
        message:
          'Queued for CAMS: Add QuizWebhook.gs (doPost) to your CAMS Apps Script & create a New Deployment Version, then click "Issue All Pending Certificates" in Admin.'
      };
    }

    return {
      ok: false,
      status: 'FAILED',
      message: (parsed && parsed.error) || `CAMS returned HTTP ${response.status}`
    };
  } catch (err) {
    return {
      ok: false,
      status: 'QUEUED_RETRY',
      message:
        err?.name === 'AbortError'
          ? 'CAMS request timed out (Slides/PDF generation may still be completing in Google Drive).'
          : `Queued (Webhook unreachable or CORS pending QuizWebhook.gs deployment: ${err?.message || 'network error'})`
    };
  }
}

export async function pingCamsWebhook(settings) {
  const webhookUrl = sanitizeAppsScriptEndpoint(settings?.camsWebhookUrl);
  if (!webhookUrl) {
    return { ok: false, message: 'CAMS Webhook URL is empty.' };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'ping',
        apiSecret: String(settings.camsApiSecret || '').trim()
      }),
      redirect: 'follow'
    });
    const text = await response.text();
    try {
      const json = JSON.parse(text);
      if (json && json.ok) {
        const qrInfo = json.qrVerifyBaseUrl ? ` · QR Target: ${json.qrVerifyBaseUrl}` : '';
        return {
          ok: true,
          message: `Connected to CAMS! Sheet: "${json.sheetName || 'Form Responses 1'}" · Prefix: "${json.prefix || 'EEE/EMBX'}"${qrInfo}`
        };
      }
      return { ok: false, message: json?.error || 'CAMS responded with an error.' };
    } catch (_) {
      if (text.includes('Script function not found: doPost')) {
        return {
          ok: false,
          needsDoPost: true,
          message:
            'Your CAMS Web App URL is reachable, but doPost() is not deployed yet! Paste the updated Apps Script files and click Deploy -> Manage deployments -> Edit -> New version.'
        };
      }
      return {
        ok: false,
        needsDoPost: true,
        message:
          'Reached Google Apps Script HTML response instead of JSON. Paste QuizWebhook.gs & Verification.gs and deploy a New Version with "Who has access: Anyone".'
      };
    }
  } catch (err) {
    return {
      ok: false,
      needsDoPost: true,
      message: `Could not reach doPost() yet (${err?.message || 'CORS / deployment check'}). Ensure QuizWebhook.gs is added and deployed with Access: Anyone.`
    };
  }
}

/**
 * Silent background JSON lookup against CAMS Apps Script (`credentials: 'omit'`).
 * Used ONLY as a background data fallback by `/verify` if a certificate row was
 * generated directly from Google Sheets/Forms before Firestore sync — NEVER redirects the browser!
 */
export async function fetchCertificateJsonFromCams(certificateId, settings) {
  const webhookUrl = sanitizeAppsScriptEndpoint(settings?.camsWebhookUrl);
  const cleanId = String(certificateId || '').trim();
  if (!webhookUrl || !cleanId) return null;

  // Attempt 1: Anonymous GET ?format=json&certificateId=... (Verification.gs)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const sep = webhookUrl.includes('?') ? '&' : '?';
    const res = await fetch(
      `${webhookUrl}${sep}format=json&certificateId=${encodeURIComponent(cleanId)}`,
      {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        redirect: 'follow',
        signal: controller.signal
      }
    );
    clearTimeout(timer);
    const txt = await res.text();
    const json = JSON.parse(txt);
    if (json && json.status) return json;
  } catch (_) {
    // Fall through to POST action: 'verify'
  }

  // Attempt 2: Anonymous POST { action: 'verify', certificateId } (QuizWebhook.gs)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(webhookUrl, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'verify', certificateId: cleanId }),
      redirect: 'follow',
      signal: controller.signal
    });
    clearTimeout(timer);
    const txt = await res.text();
    const json = JSON.parse(txt);
    if (json && json.status) return json;
  } catch (_) {}

  return null;
}

/**
 * Strips any accidental `/u/5/` or `/a/macros/<domain>/` from a backend Apps Script endpoint
 * so anonymous `fetch(..., { credentials: 'omit' })` always hits `/macros/s/<ID>/exec`.
 */
export function sanitizeAppsScriptEndpoint(rawUrl) {
  const raw = String(rawUrl || '').trim();
  if (!raw) return '';
  return raw
    .replace(/\/macros\/u\/\d+\/s\//i, '/macros/s/')
    .replace(/\/a\/macros\/[^/]+\/s\//i, '/macros/s/');
}

/**
 * Canonical public Firebase verification URL encoded onto QR codes.
 */
export function buildCanonicalFirebaseVerifyLink(certificateId) {
  if (!certificateId) return OFFICIAL_FIREBASE_VERIFY_URL;
  return `${OFFICIAL_FIREBASE_VERIFY_URL}?certificateId=${encodeURIComponent(
    String(certificateId).trim()
  )}`;
}

/**
 * Builds an in-app certificate verification link that ALWAYS stays on Firebase / current portal
 * (`/verify?certificateId=...`) and NEVER points to `script.google.com`.
 */
export function buildVerificationLink(baseUrl, certificateId) {
  const cleanId = String(certificateId || '').trim();
  let effectiveBase = String(baseUrl || '').trim();

  // Never allow Apps Script URLs as verification links
  if (!effectiveBase || /script\.google\.com|googleusercontent\.com/i.test(effectiveBase)) {
    effectiveBase =
      typeof window !== 'undefined' && window.location?.origin
        ? `${window.location.origin}/verify`
        : OFFICIAL_FIREBASE_VERIFY_URL;
  } else if (
    typeof window !== 'undefined' &&
    window.location?.origin &&
    !/embedx-assessment\.(web\.app|firebaseapp\.com)/i.test(window.location.hostname)
  ) {
    // Keep preview clicks inside the active preview host
    effectiveBase = `${window.location.origin}/verify`;
  }

  const cleanBase = effectiveBase.replace(/[?&]certificateId=.*$/i, '').replace(/\/+$/, '');
  if (!cleanId) return cleanBase;
  const sep = cleanBase.includes('?') ? '&' : '?';
  return `${cleanBase}${sep}certificateId=${encodeURIComponent(cleanId)}`;
}

/**
 * Exports submissions as a CSV formatted to match the EXACT 18 columns of
 * the live CAMS Google Sheet ('Form Responses 1' in 1jiVDFpIxGwfSlHBt3vaHl-5GFd8DPGapSS4tsR-FhJQ)
 */
export function buildCamsCompatibleCsv(submissions, settings) {
  const headers = [
    'Timestamp',
    'Email Address',
    'Participant Full Name ',
    '  Register Number  ',
    'Mobile Number',
    'Year of Study ',
    'Workshop',
    '  Department  ',
    '  Course Name  ',
    '  Conducted By  ',
    '  Course Duration  ',
    'Issue Date  ',
    'Certificate ID',
    'PDF URL',
    'Mail Status',
    'Mail Sent Time',
    'Error',
    'Slide File ID',
    'Quiz Score',
    'Quiz Percentage',
    'Warnings Used',
    'Submit Mode'
  ];

  const rows = submissions.map((s) => {
    const dt = s.submittedAt ? new Date(s.submittedAt) : new Date();
    const formattedTs = `${dt.getMonth() + 1}/${dt.getDate()}/${dt.getFullYear()} ${String(
      dt.getHours()
    ).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}:${String(
      dt.getSeconds()
    ).padStart(2, '0')}`;
    const issueDate = dt.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });
    return [
      formattedTs,
      s.email || '',
      s.fullName || '',
      s.registerNumber || '',
      s.phone || '',
      s.year || '',
      settings?.workshopName || 'Basics of Embedded Systems and Embedded Programming Language',
      s.department || 'EEE',
      settings?.quizTitle || 'EMBEDX Workshop Quiz',
      settings?.conductedBy || 'EMBEDX | Embedded Systems & Automation Club',
      settings?.courseDuration || '1 Day',
      issueDate,
      s.certificateId || '',
      s.certificatePdfUrl || '',
      s.certificateStatus === 'SENT' ? 'Sent' : '',
      s.certificateSentAt || '',
      s.certificateError || '',
      '',
      `${s.score ?? 0}/${s.totalQuestions ?? 30}`,
      `${s.percentage ?? 0}%`,
      `${s.warningsUsed ?? 0}`,
      s.submitReason || 'Manual Submit'
    ];
  });

  return [headers, ...rows]
    .map((row) =>
      row
        .map((cell) => {
          const str = String(cell ?? '');
          return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
        })
        .join(',')
    )
    .join('\r\n');
}
