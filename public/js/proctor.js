/**
 * EMBEDX Strict Mobile-First Proctoring & Anti-Cheat Engine
 *
 * Security Rules Implemented:
 * 1. Strictly bans mobile tab switching, app switching, split-screen, and focus loss.
 * 2. Defends against Android Circle to Search / Google Lens / Screen Scraping:
 *    - Instant Blackout Curtain hides quiz DOM the millisecond window blurs or exits fullscreen
 *    - Blocks long-press callouts, context menu, text selection, copy/cut/paste, drag, 3-finger screenshot
 *    - Blocks DevTools & keyboard shortcuts (F12, Ctrl+Shift+I/J/C, Ctrl+U, Ctrl+P, PrintScreen)
 * 3. Exact 2-Warning + 20-Second Wall-Clock Return Policy:
 *    - Violation #1 -> Warning 1/2 + 20-second wall-clock countdown (Date.now() tamper-proof).
 *      If not back & resumed within 20s -> AUTO SUBMIT.
 *    - Violation #2 -> Warning 2/2 (Final Warning) + 20-second wall-clock countdown.
 *      If not back & resumed within 20s -> AUTO SUBMIT.
 *    - Violation #3 -> Immediate AUTO SUBMIT (0s grace).
 */

export class ExamProctor {
  constructor(config = {}) {
    this.maxWarnings = Number(config.maxWarnings ?? 2);
    this.graceSeconds = Number(config.returnGraceSeconds ?? 20);
    this.requireFullscreen = Boolean(config.requireFullscreen ?? true);

    this.onStateChange = config.onStateChange || (() => {});
    this.onWarning = config.onWarning || (() => {});
    this.onCountdownTick = config.onCountdownTick || (() => {});
    this.onAutoSubmit = config.onAutoSubmit || (() => {});
    this.onPersist = config.onPersist || (() => {});

    this.active = false;
    this.submitted = false;
    this.warningsUsed = Number(config.initialWarningsUsed || 0);
    this.violations = Array.isArray(config.initialViolations) ? [...config.initialViolations] : [];

    // Active warning incident state
    this.warningOverlayOpen = Boolean(config.initialWarningOverlayOpen || false);
    this.warningDeadlineAt = Number(config.initialWarningDeadlineAt || 0);
    this.currentReason = config.initialReason || '';

    this.baselineViewportHeight = window.innerHeight || screen.height || 700;
    this.baselineViewportWidth = window.innerWidth || screen.width || 360;
    this.armTimestamp = 0;
    this.lastResumeAt = 0;

    this._intervalId = null;
    this._boundHandlers = {};
  }

  static isFullscreenSupported() {
    const el = document.documentElement;
    return Boolean(el && (el.requestFullscreen || el.webkitRequestFullscreen));
  }

  static isCurrentlyFullscreen() {
    return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  }

  async requestFullscreenSafe() {
    if (!this.requireFullscreen || !ExamProctor.isFullscreenSupported()) return true;
    if (ExamProctor.isCurrentlyFullscreen()) return true;
    try {
      const el = document.documentElement;
      if (el.requestFullscreen) {
        await el.requestFullscreen({ navigationUI: 'hide' });
      } else if (el.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen();
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  static exitFullscreenSafe() {
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if (document.webkitFullscreenElement && document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    } catch (_) {
      // ignore
    }
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.armTimestamp = Date.now();
    this.baselineViewportHeight = Math.max(window.innerHeight, 480);
    this.baselineViewportWidth = Math.max(window.innerWidth, 300);

    document.body.classList.add('exam-locked');

    // If restored mid-warning from a page reload, immediately check deadline!
    if (this.warningOverlayOpen && this.warningDeadlineAt > 0) {
      if (Date.now() >= this.warningDeadlineAt) {
        this._triggerAutoSubmit(
          `Did not return within ${this.graceSeconds}s on Warning ${this.warningsUsed}/${this.maxWarnings} (detected on reload)`
        );
        return;
      } else {
        this.onWarning({
          warningsUsed: this.warningsUsed,
          maxWarnings: this.maxWarnings,
          reason: this.currentReason || 'Page reloaded during active warning',
          remainingSeconds: Math.ceil((this.warningDeadlineAt - Date.now()) / 1000),
          violations: this.violations
        });
      }
    }

    const bind = (target, event, fn, opts) => {
      target.addEventListener(event, fn, opts);
      if (!this._boundHandlers[event]) this._boundHandlers[event] = [];
      this._boundHandlers[event].push({ target, fn, opts });
    };

    // 1. Tab switch / App backgrounding
    bind(document, 'visibilitychange', () => {
      if (!this.active || this.submitted) return;
      if (document.visibilityState === 'hidden') {
        this._handleViolation('Mobile tab switch / minimized browser app');
      } else {
        // Tab became visible again — immediately check if 20s deadline expired while throttled in background!
        this._checkReturnDeadlineImmediate();
      }
    });

    // 2. Window focus loss (Android Circle to Search long-press, notification shade pull-down, app switcher, Alt+Tab)
    bind(window, 'blur', () => {
      if (!this.active || this.submitted) return;
      // Ignore tiny initial fullscreen transition jitter within first 600ms
      if (Date.now() - this.armTimestamp < 600) return;
      this._handleViolation('Screen focus lost (App Switcher / Circle-to-Search / System Overlay)');
    });

    bind(window, 'focus', () => {
      if (!this.active || this.submitted) return;
      this._checkReturnDeadlineImmediate();
    });

    bind(window, 'pagehide', () => {
      if (!this.active || this.submitted) return;
      this._handleViolation('Left quiz page / browser navigation');
    });

    // 3. Fullscreen exit guard (Android gesture handle / Circle to Search / Esc)
    const onFsChange = () => {
      if (!this.active || this.submitted) return;
      if (
        this.requireFullscreen &&
        ExamProctor.isFullscreenSupported() &&
        !ExamProctor.isCurrentlyFullscreen()
      ) {
        this._handleViolation('Exited secure fullscreen mode');
      }
    };
    bind(document, 'fullscreenchange', onFsChange);
    bind(document, 'webkitfullscreenchange', onFsChange);

    // 4. Split-screen / Floating window / Pop-up view detection on mobile
    bind(window, 'resize', () => {
      if (!this.active || this.submitted) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      // Check orientation swap first (width & height swapped)
      const isRotated =
        Math.abs(w - this.baselineViewportHeight) < 160 &&
        Math.abs(h - this.baselineViewportWidth) < 160;
      if (isRotated) {
        this.baselineViewportWidth = w;
        this.baselineViewportHeight = h;
        return;
      }
      // During quiz there are NO text inputs, so virtual keyboard never opens.
      // A >36% drop in height indicates Android split-screen or floating overlay window!
      if (h < this.baselineViewportHeight * 0.64) {
        this._handleViolation('Split-screen / multi-window mode detected');
      }
    });

    // 5. Block Long-Press Callout / Context Menu / Circle-to-Search Text Highlight
    const prevent = (e) => {
      if (!this.active) return;
      e.preventDefault();
      e.stopPropagation();
      return false;
    };
    bind(document, 'contextmenu', prevent, { capture: true });
    bind(document, 'selectstart', prevent, { capture: true });
    bind(document, 'copy', prevent, { capture: true });
    bind(document, 'cut', prevent, { capture: true });
    bind(document, 'paste', prevent, { capture: true });
    bind(document, 'dragstart', prevent, { capture: true });

    // 6. Multi-finger gesture guard (3-finger swipe screenshot on Android phones)
    bind(
      document,
      'touchstart',
      (e) => {
        if (!this.active || this.submitted) return;
        if (e.touches && e.touches.length >= 3) {
          e.preventDefault();
          this._handleViolation('Multi-finger screenshot / system gesture attempted');
        }
      },
      { passive: false, capture: true }
    );

    // 7. Block PrintScreen, DevTools, View-Source, Print, Find
    bind(
      window,
      'keydown',
      (e) => {
        if (!this.active || this.submitted) return;
        const key = String(e.key || '').toLowerCase();
        const blocked =
          e.key === 'F12' ||
          e.key === 'PrintScreen' ||
          (e.ctrlKey && e.shiftKey && ['i', 'j', 'c', 's'].includes(key)) ||
          (e.metaKey && e.shiftKey && ['3', '4', '5', 's', 'i'].includes(key)) ||
          ((e.ctrlKey || e.metaKey) && ['u', 'p', 's', 'c', 'x', 'a', 'f', 'g'].includes(key));

        if (blocked) {
          e.preventDefault();
          e.stopPropagation();
          if (e.key === 'PrintScreen' || (e.metaKey && e.shiftKey)) {
            this._handleViolation('Screenshot shortcut blocked');
          }
        }
      },
      { capture: true }
    );

    // 8. Browser Back Button Guard during active exam
    try {
      history.pushState({ embedxExamGuard: true }, '', window.location.href);
      bind(window, 'popstate', () => {
        if (!this.active || this.submitted) return;
        history.pushState({ embedxExamGuard: true }, '', window.location.href);
        this._handleViolation('Attempted browser Back navigation during quiz');
      });
    } catch (_) {
      // ignore
    }

    // 9. High-frequency wall-clock watchdog (250ms) for the 20-second return timer
    this._intervalId = window.setInterval(() => {
      if (!this.active || this.submitted) return;
      this._checkReturnDeadlineImmediate();
    }, 250);

    this._emitState();
  }

  stop() {
    this.active = false;
    document.body.classList.remove('exam-locked', 'security-curtain-active');
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
    Object.keys(this._boundHandlers).forEach((event) => {
      this._boundHandlers[event].forEach(({ target, fn, opts }) => {
        target.removeEventListener(event, fn, opts);
      });
    });
    this._boundHandlers = {};
  }

  _handleViolation(reason) {
    if (!this.active || this.submitted) return;

    // Immediately engage blackout curtain so Circle-to-Search / App Switcher sees ZERO question content
    document.body.classList.add('security-curtain-active');

    // Ignore secondary events (e.g. blur + visibilitychange firing 80ms apart) while a warning overlay is ALREADY active
    if (this.warningOverlayOpen) {
      return;
    }

    // Ignore brief fullscreen re-entry bounce within 700ms of clicking Resume
    if (Date.now() - this.lastResumeAt < 700) {
      document.body.classList.remove('security-curtain-active');
      return;
    }

    const nextCount = this.warningsUsed + 1;
    const timestampIso = new Date().toISOString();

    const entry = {
      incidentNumber: nextCount,
      reason,
      timestamp: timestampIso,
      visibility: document.visibilityState,
      fullscreen: ExamProctor.isCurrentlyFullscreen()
    };
    this.violations.push(entry);

    this._playAlertFeedback();

    // Exceeded max warnings (e.g., 3rd violation when maxWarnings = 2) -> IMMEDIATE AUTO-SUBMIT!
    if (nextCount > this.maxWarnings) {
      this.warningsUsed = nextCount;
      this._persist();
      this._triggerAutoSubmit(
        `Auto-submitted: Security violation #${nextCount} (${reason}) — exceeded maximum ${this.maxWarnings} warnings`
      );
      return;
    }

    // Warning #1 or Warning #2 -> Start strict 20-second wall-clock countdown!
    this.warningsUsed = nextCount;
    this.warningOverlayOpen = true;
    this.currentReason = reason;
    this.warningDeadlineAt = Date.now() + this.graceSeconds * 1000;

    this._persist();
    this._emitState();

    this.onWarning({
      warningsUsed: this.warningsUsed,
      maxWarnings: this.maxWarnings,
      reason,
      remainingSeconds: this.graceSeconds,
      violations: this.violations
    });
  }

  _checkReturnDeadlineImmediate() {
    if (!this.warningOverlayOpen || !this.warningDeadlineAt || this.submitted) return;

    const remainingMs = this.warningDeadlineAt - Date.now();
    const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));

    this.onCountdownTick({
      remainingSeconds: remainingSec,
      remainingMs: Math.max(0, remainingMs),
      warningsUsed: this.warningsUsed,
      maxWarnings: this.maxWarnings
    });

    if (remainingMs <= 0) {
      this._triggerAutoSubmit(
        `Auto-submitted: Did not return & resume within ${this.graceSeconds} seconds during Warning ${this.warningsUsed}/${this.maxWarnings} (${this.currentReason})`
      );
    }
  }

  /**
   * Called when the student returns to the quiz tab AND taps "Resume Quiz in Fullscreen"
   * within the 20-second countdown window.
   */
  async acknowledgeAndResume() {
    if (this.submitted) return false;

    // Verify they didn't exceed the 20s deadline right as they clicked
    if (this.warningDeadlineAt && Date.now() >= this.warningDeadlineAt) {
      this._triggerAutoSubmit(
        `Auto-submitted: Return timer (${this.graceSeconds}s) expired before resuming`
      );
      return false;
    }

    this.lastResumeAt = Date.now();
    await this.requestFullscreenSafe();

    this.warningOverlayOpen = false;
    this.warningDeadlineAt = 0;
    this.currentReason = '';
    document.body.classList.remove('security-curtain-active');

    this._persist();
    this._emitState();
    return true;
  }

  _triggerAutoSubmit(finalReason) {
    if (this.submitted) return;
    this.submitted = true;
    this.warningOverlayOpen = false;
    this.warningDeadlineAt = 0;
    this.stop();
    this.onAutoSubmit({
      reason: finalReason,
      warningsUsed: this.warningsUsed,
      violations: this.violations
    });
  }

  _playAlertFeedback() {
    try {
      if (navigator.vibrate) {
        navigator.vibrate([220, 100, 220]);
      }
    } catch (_) {
      // ignore
    }
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      osc.frequency.setValueAtTime(480, ctx.currentTime + 0.14);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.32);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.33);
      setTimeout(() => ctx.close().catch(() => {}), 450);
    } catch (_) {
      // ignore audio autoplay block
    }
  }

  _persist() {
    this.onPersist({
      warningsUsed: this.warningsUsed,
      violations: this.violations,
      warningOverlayOpen: this.warningOverlayOpen,
      warningDeadlineAt: this.warningDeadlineAt,
      currentReason: this.currentReason
    });
  }

  _emitState() {
    this.onStateChange({
      warningsUsed: this.warningsUsed,
      maxWarnings: this.maxWarnings,
      violations: this.violations,
      warningOverlayOpen: this.warningOverlayOpen
    });
  }
}
