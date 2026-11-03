/**
 * CAMS (Certificate Automation Management System) Client Bridge
 *
 * Connects the EMBEDX Quiz Portal to the Google Apps Script CAMS Web App
 * (SRM TRP Engineering College — Course Completion Certificate Generator).
 *
 * Uses Content-Type: text/plain;charset=utf-8 for POST requests so browsers send
 * a CORS simple request without an OPTIONS preflight (Google Apps Script Web Apps
 * do not support OPTIONS preflight requests, only GET/POST).
 */

export async function issueCamsCertificate(submission, settings) {
  const webhookUrl = String(settings?.camsWebhookUrl || '').trim();
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
      department: String(submission.department || '').trim(),
      year: String(submission.year || '').trim(),
      college: String(submission.college || '').trim(),
      phone: String(submission.phone || '').trim(),
      workshop: String(settings.workshopName || 'Basics of Embedded Systems and Embedded Programming Language').trim(),
      courseName: String(settings.quizTitle || 'EMBEDX Workshop Quiz').trim(),
      conductedBy: String(settings.conductedBy || 'EMBEDX | Embedded Systems & Automation Club').trim(),
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
        verificationUrl: buildVerificationLink(settings.camsVerificationUrl || webhookUrl, parsed.certificateId),
        message: parsed.message || 'Certificate generated and emailed via CAMS.'
      };
    }

    // Detect when CAMS Web App exists (doGet works) but QuizWebhook.gs (doPost) hasn't been deployed yet
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
          'Queued for CAMS: Add QuizWebhook.gs (doPost) to your CAMS Apps Script & create a New Deployment Version, then click "Send Pending Certificates" in Admin.'
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
  const webhookUrl = String(settings?.camsWebhookUrl || '').trim();
  if (!webhookUrl) {
    return { ok: false, message: 'CAMS Webhook URL is empty.' };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
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
        return {
          ok: true,
          message: `Connected to CAMS! Sheet: "${json.sheetName || 'Form Responses 1'}" · Prefix: "${json.prefix || 'EEE/EMBX/'}"`
        };
      }
      return { ok: false, message: json?.error || 'CAMS responded with an error.' };
    } catch (_) {
      if (text.includes('Script function not found: doPost')) {
        return {
          ok: false,
          needsDoPost: true,
          message:
            'Your CAMS Web App URL is reachable, but doPost() is not deployed yet! Paste QuizWebhook.gs into your CAMS Apps Script editor and click Deploy -> Manage deployments -> Edit -> New version.'
        };
      }
      return {
        ok: false,
        needsDoPost: true,
        message:
          'Reached Google Apps Script HTML response instead of JSON. Paste QuizWebhook.gs and deploy a New Version with "Who has access: Anyone".'
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

export function buildVerificationLink(baseUrl, certificateId) {
  if (!baseUrl || !certificateId) return '';
  const cleanBase = String(baseUrl).trim().replace(/[?&]certificateId=.*$/i, '').replace(/\/+$/, '');
  const sep = cleanBase.includes('?') ? '&' : '?';
  return `${cleanBase}${sep}certificateId=${encodeURIComponent(certificateId)}`;
}

/**
 * Exports submissions as a CSV formatted to match the EXACT columns of
 * the live CAMS Google Sheet ('Form Responses 1' in 1jiVDFpIxGwfSlHBt3vaHl-5GFd8DPGapSS4tsR-FhJQ)
 * so Admin can also paste/import rows directly into CAMS if Gmail daily quota is ever reached!
 */
export function buildCamsCompatibleCsv(submissions, settings) {
  const headers = [
    'Timestamp',
    'Email Address',
    'Participant Full Name ',
    '  Register Number  ',
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
    const formattedTs = `${dt.getMonth() + 1}/${dt.getDate()}/${dt.getFullYear()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}:${String(dt.getSeconds()).padStart(2, '0')}`;
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
      settings?.workshopName || 'Basics of Embedded Systems and Embedded Programming Language',
      s.department || '',
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
