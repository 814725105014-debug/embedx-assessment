# EMBEDX Proctored Workshop Quiz & CAMS Certificate Portal

**EMBEDX | Embedded Systems & Automation Club**  
*Department of Electrical and Electronics Engineering · SRM TRP Engineering College*

A mobile-first, strictly proctored assessment web application containing all **30 EMBEDX Workshop Quiz questions**, integrated directly with the **CAMS (Certificate Automation Management System)** Google Workspace certificate generator and built for **Firebase Hosting + Cloud Firestore + Firebase Auth**.

---

## Key Features

### 1. Mobile-First Exam Experience
- Touch-first responsive UI optimized for Android & iOS mobile screens (`360px+` to desktop).
- Required registration mapped directly to your CAMS Google Sheet columns (`Participant Full Name`, `Email Address`, `Register Number`, `Department`, `Year`, `College`, `Mobile Number`).
- Per-student deterministic seeded shuffling of both **question order** and **MCQ option order** (prevents adjacent-seat copying and "all Option A" guessing, while preserving order if a student's page reloads).

### 2. Multi-Layer Mobile Anti-Cheat & Anti Circle-to-Search
- **HiDPI Canvas Question Shield + Student Watermark**: Questions are rendered onto a non-selectable `<canvas>` with a diagonal student Register Number watermark — blocking DOM text scraping, copy extensions, and text-highlight search overlays.
- **Instant Blackout Security Curtain**: The millisecond `window.blur`, `visibilitychange`, `pagehide`, split-screen resize, or fullscreen exit occurs (such as invoking Android Circle to Search or App Switcher), the quiz DOM is hidden and covered by a solid lockout screen.
- **2 Warnings + 20-Second Wall-Clock Return Countdown**:
  - **Violation 1**: Warning `1/2` with a tamper-proof `Date.now()` **20-second** countdown to return and tap *Resume in Fullscreen* — otherwise **auto-submits immediately**.
  - **Violation 2**: Final Warning `2/2` with a **20-second** countdown — otherwise **auto-submits immediately**.
  - **Violation 3**: **0s grace — immediate auto-submit**.
- Blocks `contextmenu`, long-press callouts, `copy`/`cut`/`paste`, 3-finger screenshot gestures, `PrintScreen`, `Ctrl+P` printing, and DevTools shortcuts.

### 3. Dedicated Single-Admin Console (`/admin`)
- Separate login restricted exclusively to `814725105014@trp.srmtrichy.edu.in` (enforced in client auth gate, Firebase Auth bootstrap, and `firestore.rules`).
- Live active test-taker monitor, submission & violation timeline inspector, 1-click retake reset, Question Bank editor, CSV exports (including a **CAMS-Exact Google Sheet CSV**), and CAMS Certificate trigger controls.

### 4. Automated CAMS Certificate Issuance
- Connects directly to your existing CAMS Google Apps Script project (`1jiVDFpIxGwfSlHBt3vaHl-5GFd8DPGapSS4tsR-FhJQ`) via `cams-integration/QuizWebhook.gs` (`doPost`).
- Automatically allocates the Certificate ID (`EEE/EMBX/...`), generates the Google Slides certificate with Coordinator/HOD/Principal signatures and QR verification code, exports the PDF to Google Drive, and emails it via Gmail upon quiz completion.

---

## Step-by-Step Setup Guide

### Step A — Enable CAMS Automatic Webhook (2 Minutes)
1. Open your CAMS Google Form → **⋮** → **Script editor**.
2. Click **+** next to *Files* → **Script** → name it `QuizWebhook`.
3. Paste the contents of [`cams-integration/QuizWebhook.gs`](./cams-integration/QuizWebhook.gs) (also available with 1-click Copy inside `/admin` → **Tab 4**).
4. Click **Deploy** → **Manage deployments** → click the **Edit (pencil)** icon on your active Web App deployment:
   - **Version**: Select **New version**
   - **Execute as**: `Me`
   - **Who has access**: `Anyone`
   - Click **Deploy**.
5. Open `/admin` → **Tab 4** → click **⚡ Test CAMS Webhook Connection** to verify!

### Step B — Create & Connect Firebase Project (5 Minutes)
1. Go to [https://console.firebase.google.com](https://console.firebase.google.com) → **Create a project** (e.g. `embedx-quiz-srmtrp`).
2. **Enable Authentication**:
   - Build → **Authentication** → **Get started** → Sign-in method → Enable **Email/Password** → Save.
   - *(On your very first sign-in at `/admin`, your authorized admin account `814725105014@trp.srmtrichy.edu.in` is automatically provisioned in Firebase Auth!)*
3. **Enable Cloud Firestore**:
   - Build → **Firestore Database** → **Create database** → Choose location (`asia-south1` Mumbai recommended for India) → Start in **Production mode**.
4. **Get Your Web App API Keys**:
   - Project Overview → **Project settings** (gear icon) → Scroll down to *Your apps* → Click **`</>` (Web)** → Register app (`EMBEDX Quiz`) → Copy the `firebaseConfig` object.
5. Paste those values into `public/js/firebase-config.js` (and update `.firebaserc` with your `projectId`).
6. Deploy Firestore rules & Hosting:
   ```bash
   npx firebase-tools login
   npx firebase-tools use YOUR_FIREBASE_PROJECT_ID
   npx firebase-tools deploy
   ```
