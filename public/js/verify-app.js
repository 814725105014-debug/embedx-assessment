/**
 * EMBEDX Native Firebase Certificate Verification Controller (`/verify`)
 *
 * Verifies certificates 100% directly on `https://embedx-assessment.web.app/verify`
 * with ZERO redirects to Google Apps Script!
 */

import { verifyCertificateDirect } from './db-service.js';
import { buildCanonicalFirebaseVerifyLink } from './cams-client.js';

const resultCard = document.getElementById('verify-result-card');
const form = document.getElementById('verify-form');
const input = document.getElementById('cert-id-input');
const submitBtn = document.getElementById('btn-verify-submit');


function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderLoadingState(certId) {
  resultCard.classList.remove('hidden');
  resultCard.innerHTML = `
    <div style="text-align:center; padding: 18px 8px;">
      <div class="verify-spinner"></div>
      <div style="font-weight:800; font-size:16px; color:#3b0764;">
        Verifying Official Certificate...
      </div>
      <div style="font-size:13px; color:#6b5a8e; margin-top:4px; font-family:monospace;">
        ${escapeHtml(certId)}
      </div>
    </div>
  `;
}

function renderVerificationResult(res) {
  resultCard.classList.remove('hidden');

  if (res.status === 'VALID') {
    const canonicalLink = buildCanonicalFirebaseVerifyLink(res.certificateId);
    const showDistinctCourse =
      res.courseName &&
      res.workshop &&
      res.courseName.trim().toLowerCase() !== res.workshop.trim().toLowerCase();

    resultCard.innerHTML = `
      <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px;">
        <span class="verify-seal valid">✓ Authentic &amp; Verified Certificate</span>
        <span style="font-size:12px; font-weight:700; color:#b45309;">Official EMBEDX Record</span>
      </div>

      <p style="margin:14px 0 0; font-size:14px; line-height:1.6; color:#4a3869;">
        This certificate was officially issued by <strong>${escapeHtml(
          res.organization || 'SRM TRP Engineering College · Dept. of EEE'
        )}</strong> and is verified in our digital certificate registry.
      </p>

      <div class="cert-id-ribbon">
        <div>
          <div class="cert-id-ribbon-label">Verified Certificate ID</div>
          <div class="cert-id-ribbon-code">${escapeHtml(res.certificateId)}</div>
        </div>
        <button type="button" id="btn-copy-verify-url" class="btn btn-gold btn-sm">
          Copy Verify Link
        </button>
      </div>

      <table class="cred-table">
        <tbody>
          <tr>
            <th>Recipient Name</th>
            <td style="font-size:15.5px; color:#3b0764;">${escapeHtml(res.name || '-')}</td>
          </tr>
          ${
            res.registerNumber
              ? `<tr>
                  <th>Register Number</th>
                  <td style="font-family:monospace;">${escapeHtml(res.registerNumber)}</td>
                </tr>`
              : ''
          }
          <tr>
            <th>Department</th>
            <td>${escapeHtml(res.department || 'Electrical and Electronics Engineering (EEE)')}</td>
          </tr>
          ${
            res.year
              ? `<tr>
                  <th>Year of Study</th>
                  <td>${escapeHtml(res.year)}</td>
                </tr>`
              : ''
          }
          <tr>
            <th>Workshop / Programme</th>
            <td>${escapeHtml(
              res.workshop ||
                res.courseName ||
                'Basics of Embedded Systems and Embedded Programming Language'
            )}</td>
          </tr>
          ${
            showDistinctCourse
              ? `<tr>
                  <th>Assessment</th>
                  <td>${escapeHtml(res.courseName)}</td>
                </tr>`
              : ''
          }
          <tr>
            <th>Conducted By</th>
            <td>${escapeHtml(
              res.conductedBy || 'EMBEDX | Embedded Systems & Automation Club'
            )}</td>
          </tr>
          ${
            res.duration
              ? `<tr>
                  <th>Duration</th>
                  <td>${escapeHtml(res.duration)}</td>
                </tr>`
              : ''
          }
          ${
            res.issueDate
              ? `<tr>
                  <th>Issued On</th>
                  <td>${escapeHtml(res.issueDate)}</td>
                </tr>`
              : ''
          }
          <tr>
            <th>Issuing Institution</th>
            <td>${escapeHtml(res.organization || 'SRM TRP Engineering College')}</td>
          </tr>
          <tr>
            <th>Certificate Status</th>
            <td style="color:#047857;">✓ Issued</td>
          </tr>
        </tbody>
      </table>

      <div class="verify-meta-foot">
        Verified on <strong>${escapeHtml(res.verifiedAt || '')}</strong><br />
        ${escapeHtml(res.source || 'EMBEDX Firebase Cloud Registry')} · SRM TRP Engineering College
      </div>
    `;

    const copyBtn = document.getElementById('btn-copy-verify-url');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(canonicalLink);
          copyBtn.textContent = '✓ Copied Link!';
          setTimeout(() => {
            copyBtn.textContent = 'Copy Verify Link';
          }, 2200);
        } catch (_) {}
      });
    }
    return;
  }

  if (res.status === 'NOT_ISSUED') {
    resultCard.innerHTML = `
      <span class="verify-seal pending">⏳ Registered · Delivery In Progress</span>
      <p style="margin:14px 0 0; font-size:14px; line-height:1.6; color:#4a3869;">
        Certificate <strong>${escapeHtml(res.certificateId)}</strong>${
      res.name ? ` for <strong>${escapeHtml(res.name)}</strong>` : ''
    } exists in the EMBEDX register, but email/PDF dispatch is still in progress (Status: <strong>${escapeHtml(
      res.mailStatus || 'Pending'
    )}</strong>). Please check again shortly.
      </p>
      <div class="verify-meta-foot">
        Checked on ${escapeHtml(res.verifiedAt || '')} · EMBEDX Official Registry
      </div>
    `;
    return;
  }

  if (res.status === 'UNAVAILABLE') {
    resultCard.innerHTML = '<span class="verify-seal pending">Verification unavailable</span><p>We could not reach the certificate registry. Please try again later.</p>';
    return;
  }

  resultCard.innerHTML = `
    <span class="verify-seal invalid">✕ Certificate Not Found</span>
    <p style="margin:14px 0 14px; font-size:14px; line-height:1.6; color:#4a3869;">
      No issued certificate in the official EMBEDX · SRM TRP Engineering College registry matches the ID below. Please check for any typing errors or scan the QR code printed on the certificate PDF.
    </p>
    <div class="cert-id-ribbon" style="border-color: rgba(220, 38, 38, 0.35); background:#fef2f2;">
      <div>
        <div class="cert-id-ribbon-label" style="color:#991b1b;">Searched Certificate ID</div>
        <div class="cert-id-ribbon-code" style="color:#991b1b;">${escapeHtml(
          res.certificateId
        )}</div>
      </div>
    </div>
    <div class="verify-meta-foot">
      Checked on ${escapeHtml(res.verifiedAt || '')} · EMBEDX Official Registry
    </div>
  `;
}

async function runVerification(rawId, pushUrl = true) {
  const certId = String(rawId || '').trim();
  if (!certId) return;

  input.value = certId;

  if (pushUrl && typeof window !== 'undefined' && window.history?.replaceState) {
    const nextUrl = `${window.location.pathname}?certificateId=${encodeURIComponent(certId)}`;
    window.history.replaceState({}, '', nextUrl);
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Verifying...';
  renderLoadingState(certId);

  try {
    const result = await verifyCertificateDirect(certId);
    renderVerificationResult(result);
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    renderVerificationResult({
      status: 'UNAVAILABLE',
      certificateId: certId,
      verifiedAt: new Date().toLocaleString('en-IN')
    });
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Verify Certificate Authenticity';
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const certId = input.value.trim();
  if (!certId) {
    input.focus();
    return;
  }
  runVerification(certId, true);
});

// Auto-verify immediately when opened via QR code scan (?certificateId=... or ?id=...)
(async function initVerifyPage() {
  const params = new URLSearchParams(window.location.search);
  const initialId = (
    params.get('certificateId') ||
    params.get('certId') ||
    params.get('id') ||
    ''
  ).trim();

  if (initialId) {
    await runVerification(initialId, false);
  }
})();
