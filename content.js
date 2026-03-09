// ============================================
// CLASSIC SUBTITLES — Content Script
// Single most-important text extraction per viewport
// YouTube caption sync via YT's own translation API
// Highlight mode, click-to-translate
// ============================================
(function () {
  'use strict';
  if (window.__spanishSubtitlesLoaded) return;
  window.__spanishSubtitlesLoaded = true;

  // ========================================================
  // SUBTITLE OVERLAY (gradient + yellow text)
  // ========================================================
  class SubtitleOverlay {
    constructor() {
      this.container = null;
      this.originalEl = null;
      this.translationEl = null;
      this.ttsRow = null;
      this.ttsButton = null;
      this.seeMoreBtn = null;
      this.closeBtn = null;
      this.collapseBtn = null;
      this._collapsed = false;
      this.showBackground = false;
      this.ttsEnabled = false;
      this._expanded = false;
      this._onClose = null; // Callback set by ClassicSubtitles
      this._ttsVoice = null;
      this._ttsVoices = [];
      this._ttsLang = 'es';
      this._inFullscreen = false;
      this._create();
      this._syncBg();
      this._watchTheme();
      this._initTTS();
    }

    _create() {
      this.container = document.createElement('div');
      this.container.id = 'ss-overlay';

      // Row wrapper: translation text + TTS button
      this.ttsRow = document.createElement('div');
      this.ttsRow.id = 'ss-tts-row';

      this.translationEl = document.createElement('div');
      this.translationEl.id = 'ss-translation';

      // "see more" / "see less" link inside translation — shown when text overflows
      this.seeMoreBtn = document.createElement('button');
      this.seeMoreBtn.id = 'ss-see-more-btn';
      this.seeMoreBtn.style.display = 'none';
      this._seeMoreLabels = this._getSeeMoreLabels();
      this.seeMoreBtn.textContent = '\u2026 ' + this._seeMoreLabels.more; // "… see more"
      this.seeMoreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._toggleExpand();
      });
      this.translationEl.appendChild(this.seeMoreBtn);

      this.ttsButton = document.createElement('button');
      this.ttsButton.id = 'ss-tts-btn';
      this.ttsButton.innerHTML = this._ttsIcon(false);
      this.ttsButton.addEventListener('click', (e) => {
        e.stopPropagation();
        this._toggleTTS();
      });

      // Collapse/expand chevron — sits to the right of the text in the tts row
      this.collapseBtn = document.createElement('button');
      this.collapseBtn.id = 'ss-collapse-btn';
      this.collapseBtn.innerHTML = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M17.9999 9.37311C18.0017 9.2646 17.9711 9.15802 17.9119 9.06701C17.8528 8.976 17.7679 8.90469 17.6681 8.8622C17.5682 8.8197 17.4579 8.80796 17.3514 8.82846C17.2448 8.84896 17.1468 8.90079 17.0698 8.9773L11.9994 13.8772L6.92897 8.9773C6.87763 8.92659 6.81674 8.88657 6.74984 8.85955C6.68293 8.83254 6.61133 8.81906 6.53918 8.8199C6.46703 8.82075 6.39579 8.8359 6.32953 8.86447C6.26328 8.89305 6.20333 8.93448 6.1532 8.98638C6.10307 9.03827 6.06373 9.09959 6.03746 9.1668C6.01119 9.234 5.9985 9.30575 6.00015 9.37788C6.0018 9.45002 6.01775 9.52111 6.04706 9.58704C6.07637 9.65298 6.11846 9.71244 6.17091 9.76199L11.6201 15.0279C11.7218 15.1263 11.8578 15.1813 11.9994 15.1813C12.1409 15.1813 12.2769 15.1263 12.3787 15.0279L17.8278 9.76199C17.8811 9.71199 17.9238 9.65181 17.9533 9.58501C17.9829 9.51821 17.9987 9.44615 17.9999 9.37311Z" fill="#F1D871" stroke="#000000" stroke-width="1.2" paint-order="stroke fill"/></svg>`;
      this.collapseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._toggleCollapse();
      });

      this.ttsRow.appendChild(this.translationEl);
      this.ttsRow.appendChild(this.ttsButton);
      this.ttsRow.appendChild(this.collapseBtn);

      this.originalEl = document.createElement('div');
      this.originalEl.id = 'ss-original';

      this.container.appendChild(this.ttsRow);
      this.container.appendChild(this.originalEl);
      document.body.appendChild(this.container);

      // Close button — floating on the page near highlighted text, not in overlay
      this.closeBtn = document.createElement('button');
      this.closeBtn.id = 'ss-close-btn';
      this.closeBtn.innerHTML = '\u2715'; // ✕
      this.closeBtn.style.display = 'none';
      this.closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this._onClose) this._onClose();
      });
      document.body.appendChild(this.closeBtn);
    }

    // ---- "See more" / "See less" labels in browser locale ----
    _getSeeMoreLabels() {
      const lang = (navigator.language || 'en').substring(0, 2).toLowerCase();
      const labels = {
        en: { more: 'see more', less: 'see less' },
        es: { more: 'ver más', less: 'ver menos' },
        fr: { more: 'voir plus', less: 'voir moins' },
        de: { more: 'mehr sehen', less: 'weniger sehen' },
        it: { more: 'vedi altro', less: 'vedi meno' },
        pt: { more: 'ver mais', less: 'ver menos' },
        ja: { more: 'もっと見る', less: '折りたたむ' },
        ko: { more: '더 보기', less: '접기' },
        zh: { more: '查看更多', less: '收起' },
        ar: { more: 'عرض المزيد', less: 'عرض أقل' },
        hi: { more: 'और देखें', less: 'कम देखें' },
        ru: { more: 'ещё', less: 'свернуть' },
        nl: { more: 'meer zien', less: 'minder zien' },
        sv: { more: 'se mer', less: 'se mindre' },
        pl: { more: 'zobacz więcej', less: 'zwiń' },
        tr: { more: 'daha fazla', less: 'daha az' },
      };
      return labels[lang] || labels.en;
    }

    // ---- TTS: inline SVG icons ----
    _ttsIcon(on) {
      // Speaker body — shared between both states
      // Black outline behind via paint-order, then gold fill on top
      const speaker = `<path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" stroke="#000000" stroke-width="2.4" stroke-linejoin="round" paint-order="stroke fill"/>`;
      if (on) {
        // Speaker with sound waves (unmuted)
        // Each arc: black outline underneath, then gold arc on top
        return `<svg viewBox="-1 -1 26 26" overflow="visible" fill="none" xmlns="http://www.w3.org/2000/svg">
          ${speaker}
          <path d="M15.54 8.46a5 5 0 010 7.07" stroke="#000000" stroke-width="4.4" stroke-linecap="round"/>
          <path d="M15.54 8.46a5 5 0 010 7.07" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M19.07 4.93a10 10 0 010 14.14" stroke="#000000" stroke-width="4.4" stroke-linecap="round"/>
          <path d="M19.07 4.93a10 10 0 010 14.14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>`;
      }
      // Speaker with X (muted)
      // Each line: black outline underneath, then gold line on top
      return `<svg viewBox="-1 -1 26 26" overflow="visible" fill="none" xmlns="http://www.w3.org/2000/svg">
        ${speaker}
        <line x1="22" y1="9" x2="16" y2="15" stroke="#000000" stroke-width="4.4" stroke-linecap="round"/>
        <line x1="22" y1="9" x2="16" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <line x1="16" y1="9" x2="22" y2="15" stroke="#000000" stroke-width="4.4" stroke-linecap="round"/>
        <line x1="16" y1="9" x2="22" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>`;
    }

    // ---- TTS: initialise voices ----
    _initTTS() {
      this._ttsMethod = null; // 'web' or 'chrome' — determined on first speak
      try {
        this._voicesChangedHandler = () => {
          this._ttsVoices = window.speechSynthesis?.getVoices() || [];
          this._pickVoice();
        };
        if (window.speechSynthesis) {
          this._voicesChangedHandler();
          window.speechSynthesis.addEventListener('voiceschanged', this._voicesChangedHandler);
          if (this._ttsVoices.length === 0) {
            setTimeout(() => this._voicesChangedHandler(), 100);
            setTimeout(() => this._voicesChangedHandler(), 1000);
          }
        }
      } catch (err) {
        console.warn('[CS] TTS init error:', err);
      }
    }

    _pickVoice() {
      const lang = this._ttsLang || 'es';
      const v = this._ttsVoices;
      if (!v.length) return;
      // Filter voices matching the target language
      const matches =
        v.filter(x => x.lang === lang + '-ES') .concat(
        v.filter(x => x.lang === lang + '-MX'),
        v.filter(x => x.lang.startsWith(lang + '-')),
        v.filter(x => x.lang.startsWith(lang)),
        v.filter(x => x.lang.includes(lang)));
      // De-duplicate while preserving order
      const seen = new Set();
      const unique = matches.filter(x => { if (seen.has(x)) return false; seen.add(x); return true; });
      if (!unique.length) { this._ttsVoice = null; return; }
      // Prefer female-sounding voices (common female voice name patterns)
      const femaleRx = /\b(female|helena|sabina|paulina|monica|lucia|elvira|conchita|penelope|lupe|mia|ines|francisca|carmen|zira|hazel|susan|samantha|fiona)\b/i;
      const female = unique.find(x => femaleRx.test(x.name));
      this._ttsVoice = female || unique[0];
    }

    _updateTTSVoice(lang) {
      this._ttsLang = lang || 'es';
      this._pickVoice();
    }

    // ---- TTS: speak via chrome.tts (background service worker) ----
    // This is the PRIMARY method — more reliable than speechSynthesis in extensions
    _speakChrome(text) {
      if (!text?.trim()) return;
      try {
        chrome.runtime.sendMessage({
          type: 'tts-speak',
          text: text.trim(),
          lang: this._ttsLang || 'es',
          rate: 0.9,
        });
      } catch (err) {
        console.warn('[CS] chrome.tts fallback error:', err);
      }
    }

    _stopChrome() {
      try {
        chrome.runtime.sendMessage({ type: 'tts-stop' });
      } catch {}
    }

    // ---- TTS: speak via Web Speech API (fallback) ----
    _speakWeb(text) {
      if (!text?.trim() || !window.speechSynthesis) return false;
      try {
        window.speechSynthesis.cancel();
        if (this._ttsVoices.length === 0) {
          this._ttsVoices = window.speechSynthesis.getVoices();
          this._pickVoice();
        }
        const utter = new SpeechSynthesisUtterance(text.trim());
        if (this._ttsVoice) utter.voice = this._ttsVoice;
        utter.lang = this._ttsLang || 'es';
        utter.rate = 0.9;
        utter.volume = 1.0;
        utter.onerror = (e) => {
          console.warn('[CS] Web TTS utterance error:', e.error);
          // If web speech fails, switch to chrome.tts for future calls
          this._ttsMethod = 'chrome';
          this._speakChrome(text);
        };
        window.speechSynthesis.speak(utter);
        window.speechSynthesis.resume();
        // Chrome auto-pause workaround
        clearInterval(this._ttsResumeInterval);
        this._ttsResumeInterval = setInterval(() => {
          if (window.speechSynthesis.speaking && window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
          } else if (!window.speechSynthesis.speaking) {
            clearInterval(this._ttsResumeInterval);
          }
        }, 200);
        return true;
      } catch (err) {
        console.warn('[CS] Web TTS error:', err);
        return false;
      }
    }

    // ---- TTS: unified speak — always uses chrome.tts (single engine) ----
    _speak(text) {
      if (!text?.trim()) return;
      // Always stop any in-progress speech first to prevent dual-engine overlap
      this._stopSpeech();
      // Use chrome.tts exclusively — it's more reliable and avoids
      // the dual-engine bug where web speech + chrome.tts play different voices
      this._speakChrome(text);
    }

    _stopSpeech() {
      try {
        clearInterval(this._ttsResumeInterval);
        window.speechSynthesis?.cancel();
        this._stopChrome();
      } catch {}
    }

    // ---- TTS: toggle mute/unmute ----
    _toggleTTS() {
      this.ttsEnabled = !this.ttsEnabled;
      this.ttsButton.innerHTML = this._ttsIcon(this.ttsEnabled);

      if (this.ttsEnabled) {
        // Speak current text immediately via chrome.tts (single engine)
        const text = this._getTranslationText();
        if (text) this._speak(text);
      } else {
        this._stopSpeech();
      }

      // Persist state
      try {
        chrome.storage.sync.get('ssSettings', (data) => {
          const s = data.ssSettings || {};
          s.ttsEnabled = this.ttsEnabled;
          chrome.storage.sync.set({ ssSettings: s });
        });
      } catch {}
    }

    _syncBg() {
      // Don't override fullscreen dark gradient set by YouTubeHandler
      if (this._inFullscreen) return;

      const bg = this._detectBg();

      if (!this.showBackground) {
        this.container.style.background = 'none';
      } else {
        const clear = this._toTransparent(bg);
        // Gradient fades over 28px, then 12px+ of solid background before text starts
        // (padding-top is 40px, so text begins at 40px from top)
        this.container.style.background =
          `linear-gradient(180deg, ${clear} 0px, ${bg} 28px)`;
      }

      // Always adapt original text color to page background
      this._syncOriginalColor(bg);

      // Adapt see-more gradient if visible
      if (this.seeMoreBtn && this.seeMoreBtn.style.display !== 'none') {
        this._syncSeeMoreBg();
      }
    }

    // Adapt original text color based on background luminance
    // Always uses full-contrast colors for maximum legibility
    _syncOriginalColor(bg) {
      if (!this.originalEl) return;
      const m = bg.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return;
      const lum = (parseInt(m[1], 10) * 299 + parseInt(m[2], 10) * 587 + parseInt(m[3], 10) * 114) / 1000;
      if (lum > 128) {
        // Light background — full black text with white outline
        this.originalEl.style.color = '#000000';
        this.originalEl.style.webkitTextStroke = '0.5px #FFFFFF';
      } else {
        // Dark background — full white text with black outline
        this.originalEl.style.color = '#FFFFFF';
        this.originalEl.style.webkitTextStroke = '0.5px #000000';
      }
    }

    _detectBg() {
      for (const el of [document.body, document.documentElement]) {
        if (!el) continue;
        const bg = getComputedStyle(el).backgroundColor;
        if (this._isColor(bg)) return bg;
      }
      const containers = [
        'main', '#__next', '#app', '#root', '.App',
        '[data-theme]', 'shreddit-app',
      ];
      for (const sel of containers) {
        try {
          const el = document.querySelector(sel);
          if (!el) continue;
          const bg = getComputedStyle(el).backgroundColor;
          if (this._isColor(bg)) return bg;
        } catch {}
      }
      return 'rgb(255, 255, 255)';
    }

    _isColor(bg) {
      return bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
    }

    _toTransparent(color) {
      const m = color.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
      return m ? `rgba(${m[1]}, ${m[2]}, ${m[3]}, 0)` : 'rgba(255,255,255,0)';
    }

    _watchTheme() {
      let themeTimer = null;
      const obs = new MutationObserver(() => {
        clearTimeout(themeTimer);
        themeTimer = setTimeout(() => this._syncBg(), 300);
      });
      const attrs = ['class', 'style', 'data-theme', 'data-color-mode', 'data-dark-theme'];
      for (const el of [document.documentElement, document.body]) {
        if (el) obs.observe(el, { attributes: true, attributeFilter: attrs });
      }
    }

    show(translation, original = '') {
      if (!this.container) return;

      // Reset expand state
      this._expanded = false;
      this.translationEl.classList.remove('ss-expanded');
      this.container.classList.remove('ss-content-expanded');
      // Don't auto-uncollapse on auto-extraction, only on user interaction
      // (ClassicSubtitles will uncollapse on click via overlay.uncollapse())
      if (this.seeMoreBtn) {
        this.seeMoreBtn.textContent = '\u2026 ' + this._seeMoreLabels.more; // "… see more"
        this.seeMoreBtn.style.display = 'none';
      }

      // Set text while preserving the see-more button child
      // Remove all children except the see-more btn, then prepend text node
      while (this.translationEl.firstChild !== this.seeMoreBtn && this.translationEl.firstChild) {
        this.translationEl.removeChild(this.translationEl.firstChild);
      }
      this.translationEl.insertBefore(document.createTextNode(translation), this.seeMoreBtn);

      this.originalEl.textContent = original;
      this.originalEl.style.display = original ? 'block' : 'none';
      this.container.classList.add('ss-visible');

      // Check for text overflow after render (show "see more" if > 3 lines)
      // Double-rAF ensures layout is fully computed even on slow pages
      this._checkOverflow();

      // Auto-speak when TTS is unmuted
      if (this.ttsEnabled && translation) {
        this._speak(translation);
      }
    }

    hide() {
      this.container?.classList.remove('ss-visible');
      // Clear stale text so it doesn't flash when the overlay fades back in
      if (this.translationEl) {
        while (this.translationEl.firstChild !== this.seeMoreBtn && this.translationEl.firstChild) {
          this.translationEl.removeChild(this.translationEl.firstChild);
        }
      }
      if (this.originalEl) this.originalEl.textContent = '';
    }

    // Get just the translation text (excludes "see more" button text)
    _getTranslationText() {
      if (!this.translationEl) return '';
      let text = '';
      for (const node of this.translationEl.childNodes) {
        if (node.nodeType === 3) text += node.textContent; // text nodes only
      }
      return text.trim();
    }

    // ---- Expand / collapse long text ----
    _toggleExpand() {
      this._expanded = !this._expanded;
      this.translationEl.classList.toggle('ss-expanded', this._expanded);
      // Also expand the overlay container so it doesn't clip
      this.container?.classList.toggle('ss-content-expanded', this._expanded);
      if (this.seeMoreBtn) {
        this.seeMoreBtn.textContent = this._expanded
          ? this._seeMoreLabels.less
          : '\u2026 ' + this._seeMoreLabels.more; // "… see more" when collapsed
      }
    }

    // Robust overflow detection: double-rAF + setTimeout fallback
    _checkOverflow() {
      const doCheck = () => {
        if (!this.translationEl || !this.seeMoreBtn) return;
        const el = this.translationEl;
        const overflows = el.scrollHeight > el.clientHeight + 2;
        this.seeMoreBtn.style.display = overflows ? 'inline' : 'none';
        if (overflows) this._syncSeeMoreBg();
      };
      // Double rAF to ensure layout is fully computed
      requestAnimationFrame(() => requestAnimationFrame(doCheck));
      // Fallback: also check after a short delay (covers slow layout engines)
      setTimeout(doCheck, 120);
    }

    // Adapt see-more gradient to page background (dark → dark fade, light → light fade)
    _syncSeeMoreBg() {
      if (!this.seeMoreBtn) return;
      const bg = this._detectBg();
      const m = bg.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
      const lum = m ? (parseInt(m[1], 10) * 299 + parseInt(m[2], 10) * 587 + parseInt(m[3], 10) * 114) / 1000 : 0;
      if (lum > 128) {
        // Light page → fade to white
        this.seeMoreBtn.style.background = 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.85) 30%)';
      } else {
        // Dark page → fade to black
        this.seeMoreBtn.style.background = 'linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.7) 30%)';
      }
    }

    // Force-uncollapse (used when user clicks text — they want to see the subtitle)
    uncollapse() {
      if (this._collapsed) {
        this._collapsed = false;
        this.container.classList.remove('ss-collapsed');
        // Reset the inline background that _syncCollapseBg set on the pill
        if (this.collapseBtn) this.collapseBtn.style.background = '';
      }
    }

    // ---- Collapse / expand overlay (hide subtitles when in the way) ----
    _toggleCollapse() {
      this._collapsed = !this._collapsed;
      this.container.classList.toggle('ss-collapsed', this._collapsed);
      if (this._collapsed) {
        // Adaptive background for the collapsed pill button
        this._syncCollapseBg();
        this._stopSpeech();
      } else {
        // Reset inline bg when expanding
        if (this.collapseBtn) this.collapseBtn.style.background = '';
      }
      // Notify ClassicSubtitles so it can pause/resume extraction
      if (typeof this._onCollapseChange === 'function') {
        this._onCollapseChange(this._collapsed);
      }
    }

    // Set collapse button background based on page luminance
    _syncCollapseBg() {
      if (!this.collapseBtn) return;
      const bg = this._detectBg();
      const m = bg.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
      const lum = m ? (parseInt(m[1], 10) * 299 + parseInt(m[2], 10) * 587 + parseInt(m[3], 10) * 114) / 1000 : 0;
      this.collapseBtn.style.background = lum > 128
        ? 'rgba(255, 255, 255, 0.65)'  // light site — semi-transparent white
        : 'rgba(0, 0, 0, 0.6)';        // dark site — semi-transparent black
    }

    // ---- Close button (click-lock dismiss) — anchored to highlighted element ----
    // Uses position:absolute with document-relative coords so it scrolls with the text.
    showCloseBtn(highlightedEl) {
      if (!this.closeBtn) return;
      if (highlightedEl) {
        const rect = highlightedEl.getBoundingClientRect();
        // Convert viewport coords to document coords (so it scrolls with the page)
        const scrollX = window.scrollX || window.pageXOffset;
        const scrollY = window.scrollY || window.pageYOffset;
        // outlineOffset is 2px, so the visible box extends 3px (1px outline + 2px offset) beyond rect
        // Position the button so its center sits on the top-right corner of the outline
        const btnSize = 18; // matches CSS width/height
        const half = btnSize / 2;
        const outlineGap = 3; // 1px outline + 2px offset
        this.closeBtn.style.top = (rect.top + scrollY - outlineGap - half) + 'px';
        this.closeBtn.style.left = (rect.right + scrollX + outlineGap - half) + 'px';
        this.closeBtn.style.right = '';
        // Adaptive background: dark bg → semi-transparent black, light bg → semi-transparent white
        const bg = this._detectBg();
        const m = bg.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
        const lum = m ? (parseInt(m[1], 10) * 299 + parseInt(m[2], 10) * 587 + parseInt(m[3], 10) * 114) / 1000 : 0;
        this.closeBtn.style.background = lum > 128
          ? 'rgba(0, 0, 0, 0.55)'         // light site → semi-transparent black bg
          : 'rgba(0, 0, 0, 0.75)';        // dark site → black bg
      }
      this.closeBtn.style.display = 'block';
    }

    hideCloseBtn() {
      if (this.closeBtn) this.closeBtn.style.display = 'none';
    }

    updateSettings(s) {
      if (!this.container) return;
      if (s.fontSize) this.translationEl.style.fontSize = s.fontSize + 'px';
      if (s.showBackground !== undefined) {
        this.showBackground = s.showBackground;
        this._syncBg();
      }
      if (s.ttsEnabled !== undefined) {
        this.ttsEnabled = s.ttsEnabled;
        if (this.ttsButton) this.ttsButton.innerHTML = this._ttsIcon(this.ttsEnabled);
        if (!this.ttsEnabled) this._stopSpeech();
      }
      if (s.targetLang) {
        this._updateTTSVoice(s.targetLang);
      }
    }

    destroy() {
      this._stopSpeech();
      clearInterval(this._ttsResumeInterval);
      if (this._voicesChangedHandler && window.speechSynthesis) {
        window.speechSynthesis.removeEventListener('voiceschanged', this._voicesChangedHandler);
      }
      this.container?.remove();
      this.container = null;
      this.closeBtn?.remove();
      this.closeBtn = null;
    }
  }

  // ========================================================
  // TRANSLATION SERVICE
  // ========================================================
  class TranslationService {
    constructor() {
      this.cache = new Map();
      this.pending = new Map();
      this._maxCache = 500; // Content-side cache limit
    }

    async translate(text, lang = 'es') {
      if (!text?.trim()) return null;
      const cleaned = text.trim().substring(0, 1500);
      const key = `${cleaned}|${lang}`;

      if (this.cache.has(key)) return this.cache.get(key);
      if (this.pending.has(key)) return this.pending.get(key);

      const p = new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage(
            { type: 'translate', text: cleaned, target: lang },
            (resp) => {
              if (chrome.runtime.lastError) { resolve(null); return; }
              const t = resp?.translation || null;
              if (t) {
                this.cache.set(key, t);
                // Evict oldest entries if cache is too large
                if (this.cache.size > this._maxCache) {
                  const firstKey = this.cache.keys().next().value;
                  this.cache.delete(firstKey);
                }
              }
              this.pending.delete(key);
              resolve(t);
            }
          );
        } catch { resolve(null); }
      });
      this.pending.set(key, p);
      return p;
    }
  }

  // ========================================================
  // TEXT EXTRACTOR — returns { text, element } or null
  // ========================================================
  class TextExtractor {
    extractSingle() {
      const h = window.location.hostname;
      if (h.includes('youtube.com')) return this._youtube();
      if (h.includes('google.com') || h.includes('google.co.')) return this._google();
      if (h.includes('reddit.com')) return this._reddit();
      if (h.includes('twitter.com') || h.includes('x.com')) return this._twitter();
      if (h.includes('instagram.com')) return this._instagram();
      if (h.includes('facebook.com')) return this._facebook();
      if (h.includes('tiktok.com')) return this._tiktok();
      if (h.includes('news.ycombinator.com')) return this._hn();
      if (h.includes('linkedin.com')) return this._linkedin();
      return this._generic();
    }

    // YouTube non-watch pages (homepage, search, channels) — extract video titles only
    _youtube() {
      const isWatch = window.location.pathname.startsWith('/watch');

      if (isWatch) {
        // Watch page: find comments, description, or sidebar recommendations
        // closest to viewport center. This enables scroll-to-translate when the
        // user scrolls past the video player.
        let best = null, bestScore = -Infinity, bestEl = null;

        // Comments
        for (const el of document.querySelectorAll('ytd-comment-renderer #content-text')) {
          if (el.closest('#ss-overlay')) continue;
          const text = this._getVisibleText(el);
          if (!text || text.length < 10 || text.length > 500) continue;
          if (!/[a-zA-Z]{2,}/.test(text)) continue;
          const rect = el.getBoundingClientRect();
          const score = this._vScore(rect);
          if (score > bestScore) { bestScore = score; best = text.substring(0, 300); bestEl = el; }
        }

        // Sidebar recommendations
        for (const el of document.querySelectorAll('ytd-compact-video-renderer #video-title')) {
          const text = (el.getAttribute('title') || '').trim();
          if (!text || text.length < 5) continue;
          const rect = el.getBoundingClientRect();
          const score = this._vScore(rect);
          if (score > bestScore) { bestScore = score; best = text.substring(0, 300); bestEl = el; }
        }

        // Video description (if visible)
        const descEl = document.querySelector('ytd-text-inline-expander #snippet-text, ytd-text-inline-expander .content');
        if (descEl) {
          const text = this._getVisibleText(descEl);
          if (text && text.length >= 20 && /[a-zA-Z]{2,}/.test(text)) {
            const rect = descEl.getBoundingClientRect();
            const score = this._vScore(rect);
            if (score > bestScore) {
              bestScore = score;
              best = text.length > 300 ? this._chunkNearCenter(text, rect) : text.substring(0, 300);
              bestEl = descEl;
            }
          }
        }

        // Video title (always visible at top)
        const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string');
        if (titleEl) {
          const text = titleEl.textContent?.trim();
          if (text && text.length >= 5) {
            const rect = titleEl.getBoundingClientRect();
            const score = this._vScore(rect);
            if (score > bestScore) { bestScore = score; best = text.substring(0, 300); bestEl = titleEl; }
          }
        }

        return best ? { text: best, element: bestEl } : null;
      }

      // Homepage/search/channel: use the 'title' attribute on #video-title elements
      // (cleaner than textContent which can include player overlay controls)
      const result = this._bestVisible([
        'ytd-rich-item-renderer #video-title',        // Homepage grid
        'ytd-video-renderer #video-title',             // Search results
        'ytd-compact-video-renderer #video-title',     // Sidebar recommendations
        'ytd-grid-video-renderer #video-title',        // Channel video grid
        'ytd-playlist-video-renderer #video-title',    // Playlist items
      ], 'title');
      if (result) return result;
      // Fallback: any visible video title or channel name
      return this._bestVisible(['#video-title', '#channel-name', '#text.ytd-channel-name'], 'title');
    }

    _reddit() {
      if (window.location.pathname.includes('/comments/')) {
        return this._redditComment();
      }
      return this._redditFeedTitle();
    }

    // Feed pages — translate only the post TITLE closest to center
    _redditFeedTitle() {
      // Shreddit (new Reddit) — post-title attribute is clean text, no flair/username
      const posts = document.querySelectorAll('shreddit-post');
      if (posts.length > 0) {
        let best = null, bestScore = -Infinity, bestEl = null;
        for (const post of posts) {
          const title = post.getAttribute('post-title');
          if (!title || title.length < 5) continue;
          const rect = post.getBoundingClientRect();
          const score = this._vScore(rect);
          if (score > bestScore) { bestScore = score; best = title; bestEl = post; }
        }
        if (best) return { text: best, element: bestEl };
      }
      // Old Reddit — target title links specifically
      return this._bestVisible([
        '[data-testid="post-title"]', '.Post h3', '.thing > .entry .title > a.title',
      ]);
    }

    // Comment pages — translate the post body OR comment closest to viewport center
    _redditComment() {
      let best = null, bestScore = -Infinity, bestEl = null;

      // Shreddit (new Reddit) — check post body/description first
      const shredditPost = document.querySelector('shreddit-post');
      if (shredditPost) {
        const bodyEl =
          shredditPost.querySelector('[slot="text-body"] .md') ||
          shredditPost.querySelector('[slot="text-body"]') ||
          shredditPost.querySelector('.md:not(shreddit-comment .md)');
        if (bodyEl) {
          const text = bodyEl.textContent?.trim();
          if (text && text.length >= 8 && /[a-zA-Z]{2,}/.test(text)) {
            const rect = bodyEl.getBoundingClientRect();
            const score = this._vScore(rect);
            if (score > bestScore) {
              bestScore = score;
              best = text.length > 300
                ? this._chunkNearCenter(text, rect)
                : text.substring(0, 300);
              bestEl = bodyEl;
            }
          }
        }
      }

      // Shreddit (new Reddit) — find comment body text within shreddit-comment elements
      const comments = document.querySelectorAll('shreddit-comment');
      if (comments.length > 0) {
        for (const comment of comments) {
          // Find the actual comment text in known content containers
          const contentEl =
            comment.querySelector('[slot="comment"] .md') ||
            comment.querySelector('[slot="comment"]') ||
            comment.querySelector('.md') ||
            comment.querySelector('p');
          if (!contentEl) continue;
          const text = contentEl.textContent?.trim();
          if (!text || text.length < 8) continue;
          if (!/[a-zA-Z]{2,}/.test(text)) continue;
          const rect = contentEl.getBoundingClientRect();
          const score = this._vScore(rect);
          if (score > bestScore) {
            bestScore = score;
            best = text.length > 300
              ? this._chunkNearCenter(text, rect)
              : text.substring(0, 300);
            bestEl = contentEl; // Highlight the content element, not the whole comment
          }
        }
      }

      if (best) return { text: best, element: bestEl };

      // Old Reddit fallback — comment body text only (not usernames/flairs)
      return this._bestVisible([
        '.comment .md > p',
        '[data-testid="comment"] div[data-click-id="text"]',
        '.usertext-body .md > p',
      ]);
    }

    // Google search — find the closest search result title (h3) to viewport center
    _google() {
      const isSearch = window.location.pathname === '/search' ||
                       window.location.search.includes('q=');
      if (isSearch) {
        // Search result page titles (the blue link headings)
        const result = this._bestVisible([
          'div.g h3',         // Standard organic results
          'h3.LC20lb',        // Direct h3 class used by Google
          'a h3',             // Any linked h3 in results
        ]);
        if (result) return result;
      }
      return this._generic();
    }

    _twitter() { return this._bestVisible(['[data-testid="tweetText"]']); }

    _instagram() {
      const path = window.location.pathname;

      // Stories — only show text captions/stickers ON the story itself, never UI chrome
      if (path.startsWith('/stories/')) {
        return this._bestVisible([
          '[class*="StoryText"] span',
          '[style*="position: absolute"] span[dir="auto"]',
        ]);
      }

      // Post detail pages — prioritize the post CAPTION over comments
      const isPost = path.startsWith('/p/') ||
                     path.startsWith('/reel/') ||
                     document.querySelector('[role="dialog"] article');

      if (isPost) {
        // The post caption is typically the FIRST span[dir="auto"] that is NOT inside
        // a comment list (<ul>). Try caption-specific locations first.
        const caption = this._bestVisible([
          'h1 + div span[dir="auto"]',          // Caption right after post header
          'article > div > div span[dir="auto"]', // Caption area (before comment list)
        ]);
        if (caption) return caption;
        // Fallback to any visible text span (including comments)
        return this._bestVisible(['span[dir="auto"]']);
      }

      // Profile pages — individual text elements (name, bio), not the whole header
      if (/^\/[^/]+\/?$/.test(path) && !path.startsWith('/p/')) {
        return this._bestVisible([
          'header section span[dir="auto"]',
          'header h2',
        ]);
      }

      // Feed page — find the ARTICLE closest to viewport center, then its caption
      return this._instagramFeedCaption();
    }

    // Instagram feed: find the post closest to viewport center and extract its caption
    _instagramFeedCaption() {
      const articles = document.querySelectorAll('article');
      if (articles.length === 0) {
        return this._bestVisible(['h1', 'span[dir="auto"]']);
      }

      let bestArticle = null, bestScore = -Infinity;
      for (const article of articles) {
        const rect = article.getBoundingClientRect();
        const score = this._vScore(rect);
        if (score > bestScore) { bestScore = score; bestArticle = article; }
      }
      if (!bestArticle) return null;

      // Within the winning article, find the caption text.
      // Captions are span[dir="auto"] — skip comment lists (<ul>) but allow
      // section containers (Instagram puts captions inside sections too).
      const spans = bestArticle.querySelectorAll('span[dir="auto"]');
      for (const span of spans) {
        // Skip if inside a comment list (comments live in <ul> elements)
        if (span.closest('ul')) continue;
        // Skip very short text (usernames, timestamps, button labels)
        const text = this._getVisibleText(span);
        if (!text || text.length < 15) continue;
        if (!/[a-zA-Z]{2,}/.test(text)) continue;
        if (this._isExcluded(span)) continue;
        if (this._isNonContentText(text)) continue;
        if (this._looksLikeCode(text)) continue;
        return { text: text.substring(0, 500), element: span };
      }

      // Fallback: any caption-like text in the article (including inside <ul>)
      for (const span of spans) {
        const text = this._getVisibleText(span);
        if (!text || text.length < 15) continue;
        if (!/[a-zA-Z]{2,}/.test(text)) continue;
        if (this._isNonContentText(text)) continue;
        if (this._looksLikeCode(text)) continue;
        return { text: text.substring(0, 500), element: span };
      }

      return null;
    }

    _facebook() {
      // Facebook feed: find the post closest to viewport center, then its caption.
      // Posts are in div[role="article"] or div[data-ad-preview] containers.
      // Post text is in div[dir="auto"] or span[dir="auto"] within the post.
      // Use _getVisibleText to skip Facebook's obfuscated anti-scrape text.

      // Try post-level containers first
      const posts = document.querySelectorAll('[role="article"]');
      if (posts.length > 0) {
        let bestPost = null, bestScore = -Infinity;
        for (const post of posts) {
          const rect = post.getBoundingClientRect();
          const score = this._vScore(rect);
          if (score > bestScore) { bestScore = score; bestPost = post; }
        }
        if (bestPost) {
          // Find the post's main text content (not comments, not UI chrome)
          const textEls = bestPost.querySelectorAll('[data-ad-preview="message"], div[dir="auto"], span[dir="auto"]');
          for (const el of textEls) {
            // Skip if inside a comment area (typically nested articles or form elements)
            if (el.closest('form')) continue;
            if (el.closest('ul')) continue;
            // Skip if the element is a nested article (comment)
            const parentArticle = el.closest('[role="article"]');
            if (parentArticle && parentArticle !== bestPost) continue;
            // Use _getVisibleText to filter out aria-hidden anti-scrape text
            const text = this._getVisibleText(el);
            if (!text || text.length < 8 || text.length > 800) continue;
            if (!/[a-zA-Z]{2,}/.test(text)) continue;
            if (this._isExcluded(el)) continue;
            if (this._isNonContentText(text)) continue;
            if (this._looksLikeCode(text)) continue;
            return { text: text.substring(0, 300), element: el };
          }
        }
      }

      // Fallback
      return this._bestVisible(['[data-ad-preview="message"]', 'div[dir="auto"]']);
    }
    _tiktok() { return this._bestVisible(['[data-e2e="browse-video-desc"]']); }
    _hn() { return this._bestVisible(['.titleline > a', '.title > a']); }
    _linkedin() {
      // LinkedIn feed: post text in update descriptions or break-words spans
      const posts = document.querySelectorAll('.feed-shared-update-v2, [data-urn]');
      if (posts.length > 0) {
        let bestPost = null, bestScore = -Infinity;
        for (const post of posts) {
          const rect = post.getBoundingClientRect();
          const score = this._vScore(rect);
          if (score > bestScore) { bestScore = score; bestPost = post; }
        }
        if (bestPost) {
          const desc = bestPost.querySelector('.feed-shared-update-v2__description') ||
                       bestPost.querySelector('.break-words span[dir="ltr"]') ||
                       bestPost.querySelector('.feed-shared-text span[dir="ltr"]') ||
                       bestPost.querySelector('span[dir="ltr"]');
          if (desc) {
            const text = this._getVisibleText(desc);
            if (text && text.length >= 8 && /[a-zA-Z]{2,}/.test(text) &&
                !this._isNonContentText(text) && !this._looksLikeCode(text)) {
              return { text: text.substring(0, 300), element: desc };
            }
          }
        }
      }
      return this._bestVisible(['.feed-shared-update-v2__description', '.break-words span[dir="ltr"]']);
    }

    _generic() {
      const heading = this._bestVisible(['h1', 'h2']);
      if (heading) return heading;
      return this._bestVisible(['article p', 'main p', 'p']);
    }

    _bestVisible(selectors, preferAttr) {
      let best = null, bestScore = -Infinity, bestEl = null;
      for (const sel of selectors) {
        try {
          for (const el of document.querySelectorAll(sel)) {
            // If preferAttr is given (e.g. 'title'), use that attribute for clean text
            // Otherwise use _getVisibleText which filters out hidden/aria-hidden nodes
            const text = (preferAttr && el.getAttribute(preferAttr))
              ? el.getAttribute(preferAttr).trim()
              : this._getVisibleText(el);
            if (!text || text.length < 8 || text.length > 800) continue;
            if (!/[a-zA-Z]{2,}/.test(text)) continue;
            if (this._isExcluded(el)) continue;
            if (this._isNonContentText(text)) continue;
            if (this._looksLikeCode(text)) continue;
            if (this._hasConcatenatedActions(text)) continue;
            const rect = el.getBoundingClientRect();
            const score = this._vScore(rect);
            if (score > bestScore) {
              bestScore = score;
              // For long text, extract sentences near viewport center
              best = text.length > 300
                ? this._chunkNearCenter(text, rect)
                : text.substring(0, 300);
              bestEl = el;
            }
          }
        } catch {}
      }
      return best ? { text: best, element: bestEl } : null;
    }

    // Skip elements inside nav, sidebar, ads, promotions, settings, notifications, etc.
    _isExcluded(el) {
      let node = el;
      while (node && node !== document.body) {
        const tag = node.tagName?.toLowerCase();
        if (tag === 'nav' || tag === 'aside' || tag === 'header' || tag === 'footer') return true;
        if (node.id === 'ss-overlay') return true;
        const id = (node.id || '').toLowerCase();
        const cls = typeof node.className === 'string' ? node.className.toLowerCase() : '';
        const tagName = (node.tagName || '').toLowerCase();

        // General UI chrome: nav, sidebar, footer, toolbar
        if (
          id.includes('sidebar') || id.includes('subnav') || id.includes('leftbar') ||
          cls.includes('sidebar') || cls.includes('flair') ||
          cls.includes('author-name') || cls.includes('username') ||
          cls.includes('tagline') || cls.includes('footer') ||
          cls.includes('nav-bar') || cls.includes('navbar') ||
          cls.includes('top-bar') || cls.includes('topbar') ||
          cls.includes('toolbar') || cls.includes('menu-item') ||
          cls.includes('dropdown') || cls.includes('popup') ||
          cls.includes('modal') || cls.includes('toast') ||
          cls.includes('notification') || cls.includes('banner') ||
          cls.includes('cookie') || cls.includes('consent')
        ) return true;

        // Ads & promotions
        if (
          id.includes('ad-') || id.includes('ads-') || id.includes('adslot') ||
          cls.includes('ad-slot') || cls.includes('ad-container') ||
          cls.includes('sponsored') || cls.includes('promoted') ||
          cls.includes('promo') || cls.includes('advertisement')
        ) return true;

        // YouTube-specific: ads, promo, masthead, guide, settings, notifications
        if (
          tagName.startsWith('ytd-ad') ||
          tagName === 'ytd-promoted-sparkles-web-renderer' ||
          tagName === 'ytd-mealbar-promo-renderer' ||
          tagName === 'ytd-statement-banner-renderer' ||
          tagName === 'ytd-brand-video-singleton-renderer' ||
          tagName === 'ytd-masthead' ||
          tagName === 'ytd-mini-guide-renderer' ||
          tagName === 'ytd-guide-renderer' ||
          tagName === 'ytd-notification-renderer' ||
          tagName === 'ytd-popup-container' ||
          tagName === 'ytd-toggle-menu-service-item-renderer' ||
          tagName === 'tp-yt-paper-dialog' ||
          id === 'masthead-container' || id === 'guide' ||
          id === 'masthead' || id === 'notification-popup'
        ) return true;

        // Reddit-specific: skip flair, author, karma elements
        const testId = node.getAttribute?.('data-testid') || '';
        if (
          testId.includes('flair') || testId.includes('author')
        ) return true;

        // Generic role checks — skip buttons, menus, navigation, alerts
        // Note: 'dialog' excluded from this check because Instagram/etc. use dialogs for content
        const role = node.getAttribute?.('role') || '';
        if (role === 'alert' || role === 'alertdialog' || role === 'banner' ||
            role === 'status' || role === 'log' || role === 'marquee' || role === 'timer' ||
            role === 'button' || role === 'menu' || role === 'menuitem' ||
            role === 'menubar' || role === 'toolbar' || role === 'tablist' ||
            role === 'navigation' || role === 'complementary') return true;

        // Skip <button>, <script>, <style>, <noscript>, <template>, <svg> elements
        if (tag === 'button' || tag === 'script' || tag === 'style' ||
            tag === 'noscript' || tag === 'template' || tag === 'svg') return true;

        // Skip timestamps
        if (tagName === 'time') return true;

        // Instagram-specific: story UI, reactions, action bars
        if (
          (cls.includes('_ac') && cls.includes('story')) || // story overlay elements
          cls.includes('coreSpriteMore') || cls.includes('coreSprite')
        ) return true;

        // Instagram/social action bars: section/div containing like/comment/share buttons
        // Detect by counting action words — if 2+ present in short text, it's an action bar
        if (tagName === 'section' || (tagName === 'div' && node.childElementCount > 1)) {
          const actionText = (node.textContent?.trim() || '').toLowerCase();
          if (actionText.length < 200) {
            const actions = ['like', 'comment', 'share', 'save', 'send', 'more',
              'me gusta', 'comentar', 'compartir', 'guardar', 'enviar', 'más',
              'reply', 'responder', 'repost', 'views', 'view all', 'ver todo'];
            const matchCount = actions.filter(a => actionText.includes(a)).length;
            if (matchCount >= 2) return true;
          }
        }

        node = node.parentElement;
      }
      return false;
    }

    // Check if text is mostly usernames/handles (should not be translated)
    _isMostlyUsernames(text) {
      if (!text) return false;
      const words = text.split(/\s+/).filter(w => w.length > 0);
      if (words.length === 0 || words.length > 20) return false;
      // Only count actual handle patterns — @user, u/user, r/sub, #hashtag
      const handleWords = words.filter(w =>
        /^@\w/.test(w) ||           // @username
        /^[ur]\/\w/.test(w) ||      // u/user or r/subreddit
        /^\/[ur]\/\w/.test(w) ||    // /u/user or /r/subreddit
        /^#\w/.test(w)              // #hashtag
      );
      return handleWords.length > 0 && handleWords.length >= words.length * 0.4;
    }

    _vScore(rect) {
      if (!rect || rect.height === 0 || rect.width === 0) return -Infinity;
      const vTop = Math.max(rect.top, 0);
      const vBot = Math.min(rect.bottom, window.innerHeight);
      const vH = vBot - vTop;
      if (vH <= 0) return -Infinity;
      const vpCenter = window.innerHeight / 2;
      const elCenter = (rect.top + rect.bottom) / 2;
      return vH - Math.abs(elCenter - vpCenter) * 0.3;
    }

    // Extract 1-2 sentences near viewport center from long text
    _chunkNearCenter(text, rect) {
      if (!text || text.length <= 300) return text?.substring(0, 300);
      const sentences = text.match(/[^.!?\n]+(?:[.!?\n]+|\s*$)/g) || [text];
      if (sentences.length <= 2) return text.substring(0, 300);
      const vpCenter = window.innerHeight / 2;
      const relY = Math.max(0, Math.min(1, (vpCenter - rect.top) / Math.max(rect.height, 1)));
      const charOffset = Math.floor(relY * text.length);
      let running = 0, idx = 0;
      for (let i = 0; i < sentences.length; i++) {
        if (running + sentences[i].length > charOffset) { idx = i; break; }
        running += sentences[i].length;
        idx = i;
      }
      return sentences.slice(idx, Math.min(sentences.length, idx + 2)).join('').trim().substring(0, 300);
    }
  }

  // ========================================================
  // YOUTUBE HANDLER
  // Tier 0: Intercepted /api/timedtext URLs (from player API trigger)
  // Tier 1: Caption tracks from /youtubei/v1/player response
  //         (works even without CC enabled — YouTube always fetches player data)
  // Tier 2: DOM caption observation
  // No title fallback — only real captions
  // ========================================================
  class YouTubeHandler {
    constructor(overlay, translator, settings) {
      this.overlay = overlay;
      this.translator = translator;
      this.settings = settings;
      this.captionTrack = null;
      this.video = null;
      this.syncInterval = null;
      this.captionObserver = null;
      this.active = false;
      this.lastCapText = '';
      this._messageHandler = null;
      this._fullscreenHandler = null;
      this._captionSource = null; // 'intercepted'|'tracks'|'dom'|'directASR'
      this._pendingTracks = null;
      this._directASRAttempted = false;
      this._tlangFailed = false; // Set true when YouTube's tlang returns degenerate data

      // Pause-mode state: when paused, show title + comments instead of captions
      this._paused = false;
      this._pauseHandler = null;
      this._playHandler = null;
      this._pauseScrollHandler = null;
      this._pauseScrollTimer = null;
      this._pauseClickHandler = null;
      this._pauseClickLocked = false;
      this._pauseObserver = null;
      this._pauseDomTimer = null;
      this._pauseLastText = '';
    }

    async init() {
      this.active = true;
      this._lastCaptionShownAt = Date.now(); // Watchdog timestamp

      // Listen for messages from MAIN world
      this._startInterceptListener();

      // Ask MAIN world to trigger caption loading via player API
      window.postMessage({ type: '__CS_REQUEST_CAPTIONS__' }, window.location.origin);

      await this._waitForVideo();
      if (!this.active) return;

      // If caption tracks arrived while waiting for video, use them
      if (this._pendingTracks) {
        await this._loadFromTracks(this._pendingTracks);
        this._pendingTracks = null;
      }

      // Start DOM caption observation as silent fallback
      this._observeDOMCaptions();

      // Failsafe: periodic DOM poll + watchdog (independent of other tiers)
      this._startDOMPoll();
      this._startWatchdog();

      // Last resort: try direct ASR (auto-generated) caption fetch after 10s
      setTimeout(() => {
        if (this.active && !this.captionTrack) {
          this._tryDirectASR();
        }
      }, 10000);

      // Listen for pause/play to toggle between captions and page-browse mode
      this._initPausePlayListeners();

      // Retry caption loading if nothing loaded yet (handles ads, slow loads)
      this._startCaptionRetry();
    }

    // Retry caption requests periodically until captions are loaded
    _startCaptionRetry() {
      if (this._captionRetryInterval) clearInterval(this._captionRetryInterval);
      let retries = 0;
      this._captionRetryInterval = setInterval(() => {
        if (!this.active || this.captionTrack || retries > 30) {
          clearInterval(this._captionRetryInterval);
          this._captionRetryInterval = null;
          return;
        }
        retries++;
        window.postMessage({ type: '__CS_REQUEST_CAPTIONS__' }, window.location.origin);
      }, 2000); // Every 2s for up to 60s

      // Listen for video playing event (e.g., after ad ends)
      if (this.video) {
        this._playingRetryHandler = () => {
          if (!this.active) return;
          if (!this.captionTrack) {
            for (const delay of [300, 1000, 2500, 5000]) {
              setTimeout(() => {
                if (this.active && !this.captionTrack) {
                  window.postMessage({ type: '__CS_REQUEST_CAPTIONS__' }, window.location.origin);
                }
              }, delay);
            }
          }
        };
        this.video.addEventListener('playing', this._playingRetryHandler);
      }

      // Watch for YouTube ad end — the player gets class 'ad-showing' during ads
      this._watchForAdEnd();
    }

    // Detect when a YouTube ad finishes and re-request captions
    _watchForAdEnd() {
      const player = document.getElementById('movie_player');
      if (!player) return;
      this._adPlaying = player.classList.contains('ad-showing');
      this._adObserver = new MutationObserver(() => {
        if (!this.active) return;
        const wasAd = this._adPlaying;
        this._adPlaying = player.classList.contains('ad-showing');
        if (wasAd && !this._adPlaying) {
          // Ad just ended — reset ALL caption state so we start fresh
          // The previous captionTrack/source may be from the ad, not the real video
          if (this.syncInterval) clearInterval(this.syncInterval);
          this.syncInterval = null;
          this.captionTrack = null;
          this._captionSource = null;
          this._pendingTracks = null;
          this._directASRAttempted = false;
          this.lastCapText = '';

          // Re-request captions aggressively
          for (const delay of [200, 800, 2000, 4000]) {
            setTimeout(() => {
              if (this.active && !this.captionTrack) {
                window.postMessage({ type: '__CS_REQUEST_CAPTIONS__' }, window.location.origin);
              }
            }, delay);
          }
        }
      });
      this._adObserver.observe(player, { attributes: true, attributeFilter: ['class'] });
    }

    // ---- Listen for messages from MAIN world ----
    _startInterceptListener() {
      this._messageHandler = (event) => {
        if (event.source !== window) return;
        if (!this.active) return;
        if (event.data?.type === '__CS_TIMEDTEXT_URL__') {
          this._onInterceptedUrl(event.data.url);
        } else if (event.data?.type === '__CS_CAPTION_TRACKS__') {
          this._onCaptionTracks(event.data.tracks);
        }
      };
      window.addEventListener('message', this._messageHandler);
    }

    // ---- Tier 0: Intercepted timedtext URL (from player API trigger) ----
    async _onInterceptedUrl(rawUrl) {
      try {
        const url = new URL(rawUrl, window.location.origin);
        // Security: only allow YouTube/Google timedtext API URLs
        // Use dot-prefix check to prevent evilyoutube.com from matching
        const h = url.hostname;
        if (!(h === 'youtube.com' || h.endsWith('.youtube.com') ||
              h === 'googlevideo.com' || h.endsWith('.googlevideo.com'))) return;
        if (!url.pathname.includes('/api/timedtext')) return;
        const lang = this.settings.targetLang || 'es';

        // Try with our target language (YouTube's own tlang translation)
        // Skip if tlang previously produced degenerate data for this video
        if (!this._tlangFailed) {
          url.searchParams.set('tlang', lang);
          url.searchParams.set('fmt', 'json3');

          let resp = await fetch(url.toString());
          if (resp.ok) {
            const data = await resp.json();
            if (this._loadCaptions(data, false)) {
              this._captionSource = 'intercepted';
              return;
            }
            // tlang data was degenerate — remember so we don't retry
            this._tlangFailed = true;
          }
        }

        // tlang rejected or degenerate — fetch original and translate ourselves
        url.searchParams.delete('tlang');
        url.searchParams.set('fmt', 'json3');
        const resp = await fetch(url.toString());
        if (resp.ok) {
          const data = await resp.json();
          if (this._loadCaptions(data, true)) {
            this._captionSource = 'intercepted';
          }
        }
      } catch {}
    }

    // ---- Tier 1: Caption tracks from /youtubei/v1/player response ----
    // Works even without CC enabled — YouTube always fetches player data
    async _onCaptionTracks(tracks) {
      if (!tracks?.length) return;
      // Don't override intercepted timedtext captions (they have valid POT tokens)
      if (this.captionTrack && this._captionSource === 'intercepted') return;

      if (!this.video) {
        this._pendingTracks = tracks;
        return;
      }

      await this._loadFromTracks(tracks);
    }

    async _loadFromTracks(tracks) {
      const track = this._pickTrack(tracks);
      if (!track?.baseUrl) return;

      // Security: validate baseUrl hostname before fetching
      try {
        const bu = new URL(track.baseUrl, window.location.origin);
        const bh = bu.hostname;
        if (!(bh === 'youtube.com' || bh.endsWith('.youtube.com') ||
              bh === 'googlevideo.com' || bh.endsWith('.googlevideo.com'))) return;
      } catch { return; }

      const lang = this.settings.targetLang || 'es';
      const sep = track.baseUrl.includes('?') ? '&' : '?';

      // Try YouTube's own translation via tlang
      // Skip if tlang previously produced degenerate data for this video
      if (!this._tlangFailed) {
        try {
          const resp = await fetch(track.baseUrl + sep + 'fmt=json3&tlang=' + lang);
          if (resp.ok) {
            const text = await resp.text();
            if (text.length > 0) {
              const data = JSON.parse(text);
              if (this._loadCaptions(data, false)) {
                this._captionSource = 'tracks';
                return;
              }
              // tlang data was degenerate — remember so we don't retry
              this._tlangFailed = true;
            }
          }
        } catch {}
      }

      // Fallback: original captions + Google Translate
      try {
        const resp = await fetch(track.baseUrl + sep + 'fmt=json3');
        if (resp.ok) {
          const text = await resp.text();
          if (text.length > 0) {
            const data = JSON.parse(text);
            if (this._loadCaptions(data, true)) {
              this._captionSource = 'tracks';
              return;
            }
          }
        }
      } catch {}
    }

    // Prefer manual captions over ASR
    _pickTrack(tracks) {
      const enManual = tracks.find(t => t.languageCode === 'en' && t.kind !== 'asr');
      if (enManual) return enManual;
      const anyManual = tracks.find(t => t.kind !== 'asr');
      if (anyManual) return anyManual;
      const enAsr = tracks.find(t => t.languageCode === 'en');
      if (enAsr) return enAsr;
      return tracks[0];
    }

    // ---- Video element ----
    _waitForVideo() {
      return new Promise((resolve) => {
        let n = 0;
        const ck = () => {
          if (!this.active || n > 30) { resolve(); return; }
          n++;
          this.video = document.querySelector('video');
          this.video ? resolve() : setTimeout(ck, 500);
        };
        ck();
      });
    }

    // ---- Caption loading and sync ----
    _loadCaptions(data, needsTranslation) {
      if (!data?.events) return false;
      const track = data.events
        .filter(e => e.segs)
        .map(e => ({
          start: (e.tStartMs || 0) / 1000,
          end: ((e.tStartMs || 0) + (e.dDurationMs || 3000)) / 1000,
          text: e.segs.map(s => s.utf8 || '').join('').trim(),
        }))
        .filter(c => c.text.length > 0);
      if (track.length === 0) return false;

      // Detect degenerate tracks — YouTube's tlang translation sometimes merges
      // all captions into very few entries with huge durations (entire video in
      // one subtitle). Reject these so caller falls back to original + Google Translate.
      {
        let maxDur = 0;
        let totalDur = 0;
        for (const c of track) {
          const dur = c.end - c.start;
          if (dur > maxDur) maxDur = dur;
          totalDur += dur;
        }
        const avgDur = totalDur / track.length;
        // Any single caption > 25s is degenerate (normal captions are 2-8s)
        if (maxDur > 25) return false;
        // Average duration > 12s with 3+ entries means degenerate merge
        if (track.length >= 3 && avgDur > 12) return false;
        // Very few entries for a long video span — likely degenerate merge
        if (track.length < 3) {
          const totalSpan = track[track.length - 1].end - track[0].start;
          if (totalSpan > 20) return false;
        }
      }

      this.captionTrack = track;
      this._startSync(needsTranslation);
      return true;
    }

    _startSync(needsTranslation) {
      if (this.syncInterval) clearInterval(this.syncInterval);
      if (!this.captionTrack || !this.video) return;
      let lastIdx = -1;
      let lastIdxTime = 0; // When lastIdx was set — detect stuck captions
      let hasPlayed = false; // Don't show captions until video actually plays
      this.syncInterval = setInterval(async () => {
        if (!this.active) return;
        if (this._paused) return; // Pause mode handles overlay

        // Refresh video ref if stale (YouTube can swap video elements)
        if (!this.video || !document.contains(this.video)) {
          this.video = document.querySelector('video');
          if (!this.video) return;
        }

        // Wait until the video has actually started playing before showing captions.
        // This prevents the opening line from appearing and getting stuck while
        // the video is still loading or showing an ad.
        if (!hasPlayed) {
          if (this.video.paused || this.video.readyState < 3 || this.video.currentTime < 0.5) return;
          hasPlayed = true;
        }

        const t = this.video.currentTime;
        const idx = this._findCaption(t, lastIdx);
        if (idx !== -1 && idx !== lastIdx) {
          lastIdx = idx;
          lastIdxTime = Date.now();
          this._lastCaptionShownAt = Date.now(); // Stamp watchdog
          const text = this.captionTrack[idx].text;
          if (needsTranslation) {
            const tr = await this.translator.translate(text, this.settings.targetLang || 'es');
            if (tr && this.active) this.overlay.show(tr, this.settings.showOriginal ? text : '');
          } else {
            if (this.active) this.overlay.show(text);
          }
        } else if (idx === -1 && lastIdx !== -1) {
          lastIdx = -1;
          this.overlay.hide();
        } else if (idx !== -1 && idx === lastIdx && !this.video.paused) {
          // Same caption for too long while video plays — likely stuck on a
          // degenerate track. Fully invalidate and re-request captions.
          const stuckDur = Date.now() - lastIdxTime;
          if (stuckDur > 15000) {
            // Clear the bad caption track entirely so fresh data loads
            if (this.syncInterval) clearInterval(this.syncInterval);
            this.syncInterval = null;
            this.captionTrack = null;
            this._captionSource = null;
            this._directASRAttempted = false;
            this.overlay.hide();
            // Re-request captions from MAIN world
            window.postMessage({ type: '__CS_REQUEST_CAPTIONS__' }, window.location.origin);
            return; // syncInterval is cleared, this callback won't run again
          }
        }
      }, 200);
    }

    // Binary search with nearby-index hint for O(1) typical / O(log n) worst case
    _findCaption(time, hint) {
      const track = this.captionTrack;
      if (!track || track.length === 0) return -1;

      // Fast path: check near previous index first (typical case during playback)
      if (hint >= 0) {
        for (let i = Math.max(0, hint - 1); i <= Math.min(track.length - 1, hint + 2); i++) {
          if (time >= track[i].start && time < track[i].end) return i;
        }
      }

      // Binary search for the right segment
      let lo = 0, hi = track.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (time < track[mid].start) hi = mid - 1;
        else if (time >= track[mid].end) lo = mid + 1;
        else return mid;
      }
      return -1;
    }

    // ---- DOM caption observation (fallback) ----
    _observeDOMCaptions() {
      if (this.captionObserver) return;
      this.captionObserver = new MutationObserver(() => {
        // Don't override intercepted captions with DOM captions — unless they've gone stale
        if (this._captionSource === 'intercepted' &&
            (Date.now() - (this._lastCaptionShownAt || 0)) < 8000) return;
        if (this._paused) return; // Pause mode handles overlay

        // Scope query to caption container for efficiency
        const container = document.querySelector('.ytp-caption-window-container') || document.querySelector('#movie_player');
        const segs = container?.querySelectorAll('.ytp-caption-segment') ||
                     document.querySelectorAll('.ytp-caption-segment');
        if (segs.length) {
          const text = Array.from(segs).map(s => s.textContent).join(' ').trim();
          if (text && text !== this.lastCapText) {
            this.lastCapText = text;
            this._translateAndShow(text);
          }
        }
      });
      // Only observe #movie_player — never fall back to document.body (too expensive)
      const player = document.querySelector('#movie_player');
      if (player) {
        this.captionObserver.observe(player, {
          childList: true, subtree: true, characterData: true,
        });
      } else {
        // Retry until player appears
        let retries = 0;
        const retry = setInterval(() => {
          retries++;
          const p = document.querySelector('#movie_player');
          if (p) {
            this.captionObserver.observe(p, {
              childList: true, subtree: true, characterData: true,
            });
            clearInterval(retry);
          } else if (retries > 20) {
            clearInterval(retry);
          }
        }, 500);
      }
    }

    async _translateAndShow(text) {
      const tr = await this.translator.translate(text, this.settings.targetLang || 'es');
      if (tr && this.active) {
        this._lastCaptionShownAt = Date.now();
        this.overlay.show(tr, this.settings.showOriginal ? text : '');
      }
    }

    // ---- Failsafe 1: Periodic DOM poll (independent of MutationObserver) ----
    // Catches captions even when the observer misses mutations or _captionSource blocks it.
    _startDOMPoll() {
      if (this._domPollInterval) clearInterval(this._domPollInterval);
      this._domPollInterval = setInterval(() => {
        if (!this.active || this._paused) return;
        if (!this.video || this.video.paused) return;

        // If intercepted/track captions are actively working (shown in last 5s), skip
        if (this._captionSource && (Date.now() - (this._lastCaptionShownAt || 0)) < 5000) return;

        // Check DOM for caption segments
        const segs = document.querySelectorAll('.ytp-caption-segment');
        if (segs.length === 0) return;
        const text = Array.from(segs).map(s => s.textContent).join(' ').trim();
        if (!text || text === this.lastCapText) return;

        // DOM has fresh captions — use them
        this.lastCapText = text;
        this._captionSource = 'dom';
        this._translateAndShow(text);
      }, 2000);
    }

    // ---- Failsafe 2: Watchdog — detect stale caption state and recover ----
    _startWatchdog() {
      if (this._watchdogInterval) clearInterval(this._watchdogInterval);
      let _ccForced = false;
      this._watchdogInterval = setInterval(() => {
        if (!this.active) return;
        if (!this.video || this.video.paused || this._paused) return;

        const elapsed = Date.now() - (this._lastCaptionShownAt || 0);

        // If video is playing but no caption shown for 8+ seconds, try recovery
        if (elapsed > 8000) {
          // Reset caption source so DOM observer and poll can work freely
          if (this._captionSource === 'intercepted' || this._captionSource === 'tracks') {
            this._captionSource = null;
          }

          // Re-request captions from MAIN world
          window.postMessage({ type: '__CS_REQUEST_CAPTIONS__' }, window.location.origin);
        }

        // If no captions for 15+ seconds, try forcing YouTube's CC button on
        if (elapsed > 15000 && !_ccForced) {
          _ccForced = true;
          this._forceCCOn();
        }

        // If no captions for 25+ seconds and no track loaded, try direct ASR
        if (elapsed > 25000 && !this.captionTrack && !this._directASRAttempted) {
          this._directASRAttempted = true;
          this._tryDirectASR();
        }
      }, 4000);
    }

    // ---- Failsafe 3: Force YouTube's CC button on ----
    _forceCCOn() {
      try {
        const player = document.getElementById('movie_player');
        if (!player) return;
        // Use YouTube's player API to force captions on
        if (typeof player.setOption === 'function') {
          const tracklist = player.getOption?.('captions', 'tracklist');
          if (tracklist?.length) {
            player.setOption('captions', 'track', tracklist[0]);
            return;
          }
        }
        // Fallback: click the CC button directly
        const ccBtn = player.querySelector('.ytp-subtitles-button');
        if (ccBtn && ccBtn.getAttribute('aria-pressed') !== 'true') {
          ccBtn.click();
        }
      } catch {}
    }

    // ---- Failsafe 4: Last-resort caption recovery ----
    // Re-requests caption data from MAIN world (which re-extracts from ytInitialPlayerResponse
    // and alternate player data sources). Also sets up a one-shot listener for tracks that
    // may arrive from the re-extraction.
    async _tryDirectASR() {
      if (!this.active || this.captionTrack) return;

      // Send aggressive re-request — MAIN world will re-check ytInitialPlayerResponse
      // and alternate player data sources even if its cache was cleared
      window.postMessage({ type: '__CS_REQUEST_CAPTIONS__' }, window.location.origin);

      // Wait 3s, then if still no captions, try forcing CC and request again
      await new Promise(r => setTimeout(r, 3000));
      if (!this.active || this.captionTrack) return;

      this._forceCCOn();
      window.postMessage({ type: '__CS_REQUEST_CAPTIONS__' }, window.location.origin);

      // Wait another 5s, then show title fallback if truly no captions
      await new Promise(r => setTimeout(r, 5000));
      if (!this.active || this.captionTrack) return;

      // Last resort: show translated title
      this._showNoCaptionsFallback();
    }

    // Show translated page title when no captions exist at all
    async _showNoCaptionsFallback() {
      if (!this.active) return;
      // Get the video title
      const titleEl = document.querySelector(
        'h1.ytd-watch-metadata yt-formatted-string, ' +
        'h1.ytd-video-primary-info-renderer, ' +
        '#info-contents h1, ' +
        'h1.slim-video-metadata-header--title'
      );
      const title = titleEl?.textContent?.trim() || document.title?.replace(/ - YouTube$/, '').trim();
      if (!title) return;

      const tr = await this.translator.translate(title, this.settings.targetLang || 'es');
      if (tr && this.active) {
        this.overlay.show(tr, this.settings.showOriginal ? title : '');
      }
    }

    // ---- Pause-mode: show title + comments when paused ----

    _initPausePlayListeners() {
      if (!this.video) return;

      this._pauseHandler = () => {
        if (!this.active) return;
        this._enterPauseMode();
      };
      this._playHandler = () => {
        if (!this.active) return;
        this._exitPauseMode();
      };

      this.video.addEventListener('pause', this._pauseHandler);
      this.video.addEventListener('play', this._playHandler);
      this.video.addEventListener('playing', this._playHandler);

      // Handle video that starts already paused
      if (this.video.paused) {
        this._enterPauseMode();
      }
    }

    _enterPauseMode() {
      if (this._paused) return;
      this._paused = true;
      this._pauseClickLocked = false;
      this._pauseLastText = '';

      // Show translated title immediately
      this._showPauseTitle();

      // Start scroll/hover/click/observer for comments
      this._startPauseScroll();
      this._startPauseHover();
      this._startPauseClick();
      this._startPauseCommentObserver();
    }

    _exitPauseMode() {
      if (!this._paused) return;
      this._paused = false;
      this._pauseClickLocked = false;
      this._pauseLastText = '';

      this._stopPauseScroll();
      this._stopPauseHover();
      this._stopPauseClick();
      this._stopPauseCommentObserver();

      // Clear stale overlay so caption sync takes over cleanly
      this.overlay.hide();
    }

    async _showPauseTitle() {
      if (!this._paused || !this.active) return;

      const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')
        || document.querySelector('#title h1');
      const titleText = titleEl?.textContent?.trim();
      if (!titleText || titleText.length < 2) return;

      this._pauseLastText = titleText;

      const tr = await this.translator.translate(titleText, this.settings.targetLang || 'es');
      if (tr && this._paused && this.active) {
        this.overlay.show(tr, this.settings.showOriginal ? titleText : '');
      }
    }

    async _showPauseBestComment() {
      if (!this._paused || !this.active) return;
      if (this._pauseClickLocked) return;

      let best = null, bestScore = -Infinity;

      try {
        for (const el of document.querySelectorAll('ytd-comment-renderer #content-text')) {
          const text = el.textContent?.trim();
          if (!text || text.length < 5 || text.length > 500) continue;

          // Skip our own overlay
          if (el.closest('#ss-overlay')) continue;

          const rect = el.getBoundingClientRect();
          const score = this._vScore(rect);
          if (score > bestScore) {
            bestScore = score;
            best = text.substring(0, 300);
          }
        }
      } catch {}

      // If no comments visible, keep showing title
      if (!best) {
        if (!this._pauseLastText) this._showPauseTitle();
        return;
      }

      if (best === this._pauseLastText) return;
      this._pauseLastText = best;

      const tr = await this.translator.translate(best, this.settings.targetLang || 'es');
      if (tr && this._paused && this.active) {
        this.overlay.show(tr, this.settings.showOriginal ? best : '');
      }
    }

    // Viewport-center scoring (same as TextExtractor._vScore)
    _vScore(rect) {
      if (!rect || rect.height === 0 || rect.width === 0) return -Infinity;
      const vTop = Math.max(rect.top, 0);
      const vBot = Math.min(rect.bottom, window.innerHeight);
      const vH = vBot - vTop;
      if (vH <= 0) return -Infinity;
      const vpCenter = window.innerHeight / 2;
      const elCenter = (rect.top + rect.bottom) / 2;
      return vH - Math.abs(elCenter - vpCenter) * 0.3;
    }

    _startPauseScroll() {
      let scrolling = false;
      this._pauseScrollHandler = () => {
        if (!this._paused) return;
        this._pauseClickLocked = false;

        if (!scrolling) {
          scrolling = true;
          this._showPauseBestComment();
        }
        clearTimeout(this._pauseScrollTimer);
        this._pauseScrollTimer = setTimeout(() => {
          scrolling = false;
          this._showPauseBestComment();
        }, 150);
      };
      window.addEventListener('scroll', this._pauseScrollHandler, { passive: true });
    }

    _stopPauseScroll() {
      if (this._pauseScrollHandler) {
        window.removeEventListener('scroll', this._pauseScrollHandler);
        this._pauseScrollHandler = null;
      }
      clearTimeout(this._pauseScrollTimer);
      this._pauseScrollTimer = null;
    }

    _startPauseHover() {
      this._pauseHoverHandler = (e) => {
        if (!this._paused || !this.active) return;
        if (this._pauseClickLocked) return;

        // Walk up from hovered element to find a comment
        let el = e.target;
        while (el && el !== document.body) {
          // Skip our own overlay
          if (el.id === 'ss-overlay' || el.id === 'ss-translation' || el.id === 'ss-original') return;

          const commentParent = el.closest('ytd-comment-renderer');
          if (commentParent) {
            const contentEl = commentParent.querySelector('#content-text');
            const text = contentEl?.textContent?.trim();
            if (text && text.length >= 5) {
              const cleaned = text.substring(0, 300);
              if (cleaned === this._pauseLastText) return; // Already showing
              this._pauseLastText = cleaned;
              this._translateAndShowPause(cleaned);
            }
            return;
          }
          el = el.parentElement;
        }
      };
      document.addEventListener('mouseover', this._pauseHoverHandler, true);
    }

    _stopPauseHover() {
      if (this._pauseHoverHandler) {
        document.removeEventListener('mouseover', this._pauseHoverHandler, true);
        this._pauseHoverHandler = null;
      }
    }

    _startPauseClick() {
      this._pauseClickHandler = (e) => {
        if (!this._paused || !this.active) return;

        let el = e.target;
        while (el && el !== document.body) {
          if (el.id === 'ss-overlay' || el.id === 'ss-translation' || el.id === 'ss-original') return;

          const commentParent = el.closest('ytd-comment-renderer');
          if (commentParent) {
            const contentEl = commentParent.querySelector('#content-text');
            const text = contentEl?.textContent?.trim();
            if (text && text.length >= 5 && text.length <= 500) {
              const cleaned = text.substring(0, 300);
              if (cleaned === this._pauseLastText) return;
              this._pauseLastText = cleaned;
              this._pauseClickLocked = true;
              this._translateAndShowPause(cleaned);
              return;
            }
          }
          el = el.parentElement;
        }

        // Clicked non-comment area — unlock
        this._pauseClickLocked = false;
        this._pauseLastText = '';
        this._showPauseBestComment();
      };
      document.addEventListener('click', this._pauseClickHandler, true);
    }

    _stopPauseClick() {
      if (this._pauseClickHandler) {
        document.removeEventListener('click', this._pauseClickHandler, true);
        this._pauseClickHandler = null;
      }
    }

    async _translateAndShowPause(text) {
      const tr = await this.translator.translate(text, this.settings.targetLang || 'es');
      if (tr && this._paused && this.active) {
        this.overlay.show(tr, this.settings.showOriginal ? text : '');
      }
    }

    _startPauseCommentObserver() {
      const commentSection = document.querySelector('ytd-comments#comments');
      if (!commentSection) return;

      this._pauseObserver = new MutationObserver(() => {
        clearTimeout(this._pauseDomTimer);
        this._pauseDomTimer = setTimeout(() => {
          if (this._paused && this.active) {
            this._showPauseBestComment();
          }
        }, 300);
      });
      this._pauseObserver.observe(commentSection, { childList: true, subtree: true });
    }

    _stopPauseCommentObserver() {
      if (this._pauseObserver) {
        this._pauseObserver.disconnect();
        this._pauseObserver = null;
      }
      clearTimeout(this._pauseDomTimer);
      this._pauseDomTimer = null;
    }

    // ---- Fullscreen ----
    handleFullscreen() {
      this._fullscreenHandler = () => {
        if (!this.active || !this.overlay.container) return;
        if (document.fullscreenElement) {
          try { document.fullscreenElement.appendChild(this.overlay.container); } catch {}
          // No background in fullscreen — yellow text with black stroke
          // is perfectly readable against video content
          this.overlay.container.style.background = 'none';
          // Mark fullscreen so _syncBg() won't override
          this.overlay._inFullscreen = true;
          // Original text: white on black in fullscreen
          this.overlay._syncOriginalColor('rgb(0, 0, 0)');
        } else {
          try { document.body.appendChild(this.overlay.container); } catch {}
          this.overlay._inFullscreen = false;
          // Restore normal background behavior
          this.overlay._syncBg();
        }
      };
      document.addEventListener('fullscreenchange', this._fullscreenHandler);
    }

    // ---- Cleanup ----
    destroy() {
      this.active = false;

      // Clean up pause mode
      this._exitPauseMode();
      this._paused = false;

      // Remove video event listeners
      if (this.video && this._pauseHandler) {
        this.video.removeEventListener('pause', this._pauseHandler);
        this._pauseHandler = null;
      }
      if (this.video && this._playHandler) {
        this.video.removeEventListener('play', this._playHandler);
        this.video.removeEventListener('playing', this._playHandler);
        this._playHandler = null;
      }

      if (this.syncInterval) clearInterval(this.syncInterval);
      if (this.captionObserver) this.captionObserver.disconnect();
      if (this._messageHandler) {
        window.removeEventListener('message', this._messageHandler);
        this._messageHandler = null;
      }
      if (this._fullscreenHandler) {
        document.removeEventListener('fullscreenchange', this._fullscreenHandler);
        this._fullscreenHandler = null;
      }
      if (this._captionRetryInterval) {
        clearInterval(this._captionRetryInterval);
        this._captionRetryInterval = null;
      }
      if (this.video && this._playingRetryHandler) {
        this.video.removeEventListener('playing', this._playingRetryHandler);
        this._playingRetryHandler = null;
      }
      if (this._adObserver) {
        this._adObserver.disconnect();
        this._adObserver = null;
      }
      if (this._domPollInterval) {
        clearInterval(this._domPollInterval);
        this._domPollInterval = null;
      }
      if (this._watchdogInterval) {
        clearInterval(this._watchdogInterval);
        this._watchdogInterval = null;
      }
      this._captionSource = null;
      this.captionTrack = null;
      this._pendingTracks = null;
      this._directASRAttempted = false;
    }
  }

  // ========================================================
  // HTML5 VIDEO HANDLER
  // ========================================================
  class VideoHandler {
    constructor(overlay, translator, settings) {
      this.overlay = overlay;
      this.translator = translator;
      this.settings = settings;
      this.handled = new WeakSet();
      this.observer = null;
    }

    init() {
      document.querySelectorAll('video').forEach(v => this._handle(v));
      this.observer = new MutationObserver((muts) => {
        for (const m of muts) {
          for (const n of m.addedNodes) {
            if (n.nodeName === 'VIDEO') this._handle(n);
            else if (n.querySelectorAll) n.querySelectorAll('video').forEach(v => this._handle(v));
          }
        }
      });
      this.observer.observe(document.body, { childList: true, subtree: true });
    }

    _handle(video) {
      if (this.handled.has(video)) return;
      this.handled.add(video);
      const check = () => {
        if (!video.textTracks) return;
        for (let i = 0; i < video.textTracks.length; i++) {
          const t = video.textTracks[i];
          if (t.kind === 'subtitles' || t.kind === 'captions') {
            if (t.mode === 'disabled') t.mode = 'hidden';
            t.addEventListener('cuechange', () => {
              const cue = t.activeCues?.[0];
              if (cue) {
                const clean = cue.text.replace(/<[^>]+>/g, '').trim();
                if (clean) this._translate(clean);
              }
            });
          }
        }
      };
      check();
      video.addEventListener('loadedmetadata', check);
    }

    async _translate(text) {
      const tr = await this.translator.translate(text, this.settings.targetLang || 'es');
      if (tr) this.overlay.show(tr, this.settings.showOriginal ? text : '');
    }

    destroy() { this.observer?.disconnect(); }
  }

  // ========================================================
  // MAIN ENGINE
  // ========================================================
  class ClassicSubtitles {
    constructor() {
      this.settings = {
        enabled: true,
        fontSize: 24,
        showOriginal: false,
        showBackground: false,
        highlightMode: false,
        targetLang: 'es',
        ttsEnabled: false,
      };
      this.overlay = null;
      this.translator = null;
      this.extractor = null;
      this.ytHandler = null;
      this.videoHandler = null;
      this.lastText = '';
      this.scrollTimer = null;
      this.domObserver = null;
      this._domTimer = null;
      this._highlightedEl = null;
      this._boundScroll = null;
      this._boundClick = null;
      this._boundNav = null;
      this._boundVisibility = null;
      this._boundHover = null;
      this._hoverLocked = false; // When true, hover text is being shown (lower priority than click)
      this._hoverTimer = null;
      this._scrolling = false;
      this._clickLocked = false; // When true, _showBest won't override user's click selection
      this._igScrollEl = null;   // Instagram comment scroll container
      this._igScrollHandler = null;
      this._ytNavHandler = null;
      this._ytUrlCheck = null;
      this._ytNavDebounce = false;
      this._lastYTUrl = '';
      this._translateGen = 0; // Generation counter to prevent stale translations overwriting newer ones
    }

    async start() {
      await this._loadSettings();

      // Always listen for settings changes (even when disabled) so that
      // toggling the extension on works immediately without a page reload.
      this._listenSettings();

      if (!this.settings.enabled) return;

      this._boot();
    }

    // Create overlay/translator/extractor and start subtitle extraction.
    // Called once on first enable (initial load or toggled on from popup).
    _boot() {
      if (!this.overlay) {
        this.overlay = new SubtitleOverlay();
        this.overlay._onClose = () => this._onCloseOverlay();
        this.overlay._onCollapseChange = (collapsed) => {
          if (!collapsed) {
            // Re-trigger subtitle extraction immediately on expand
            this.lastText = '';
            this._showBest();
          }
        };
      }
      if (!this.translator) this.translator = new TranslationService();
      if (!this.extractor) this.extractor = new TextExtractor();
      this.overlay.updateSettings(this.settings);

      if (this._isYTWatch()) {
        this._initYouTube();
      } else {
        this._initPage();
      }
    }

    _isYTWatch() {
      return (
        window.location.hostname.includes('youtube.com') &&
        window.location.pathname.startsWith('/watch')
      );
    }

    // ---- YouTube ----
    _initYouTube() {
      // Clean up any existing nav watchers from previous init
      if (this._ytNavHandler) {
        document.removeEventListener('yt-navigate-finish', this._ytNavHandler);
      }
      if (this._ytUrlCheck) {
        clearInterval(this._ytUrlCheck);
      }

      this.ytHandler = new YouTubeHandler(this.overlay, this.translator, this.settings);
      this.ytHandler.init();
      this.ytHandler.handleFullscreen();

      // Scroll handler for watch pages — shows comments/sidebar when player is out of view
      if (this._ytPageScrollHandler) window.removeEventListener('scroll', this._ytPageScrollHandler);
      this._ytPageScrollHandler = () => this._onYTPageScroll();
      window.addEventListener('scroll', this._ytPageScrollHandler, { passive: true });

      this._lastYTUrl = location.href;

      // Primary: YouTube's own SPA navigation event
      this._ytNavHandler = () => this._onYTNavigate();
      document.addEventListener('yt-navigate-finish', this._ytNavHandler);

      // Fallback: URL polling for edge cases where yt-navigate-finish doesn't fire
      this._ytUrlCheck = setInterval(() => {
        if (location.href !== this._lastYTUrl) {
          this._onYTNavigate();
        }
      }, 2000);
    }

    _onYTNavigate() {
      // Debounce — prevent double-firing from both detection mechanisms
      if (this._ytNavDebounce) return;
      this._ytNavDebounce = true;
      setTimeout(() => { this._ytNavDebounce = false; }, 2500);

      this._lastYTUrl = location.href;
      this.ytHandler?.destroy();
      this._stopPage();
      this.overlay?._stopSpeech();
      this.overlay?.hide();
      this.overlay?.hideCloseBtn();
      this._clickLocked = false;
      this._hoverLocked = false;
      this._clearHighlight();
      this.lastText = '';

      setTimeout(() => {
        this.overlay?._syncBg();
        if (this._isYTWatch()) {
          this.ytHandler = new YouTubeHandler(this.overlay, this.translator, this.settings);
          this.ytHandler.init();
          this.ytHandler.handleFullscreen();
        } else {
          if (this.overlay?.container) document.body.appendChild(this.overlay.container);
          this._initPage();
        }
      }, 1500);
    }

    _onYTPageScroll() {
      // Only for watch pages — shows comments/sidebar when player is out of view
      if (!this._isYTWatch()) return;
      if (this._clickLocked) return;

      // If video is playing and player is visible, let captions handle it
      const player = document.getElementById('movie_player');
      if (player) {
        const rect = player.getBoundingClientRect();
        // If player bottom is above viewport 30% mark, user has scrolled past it
        if (rect.bottom > window.innerHeight * 0.3) return;
      }

      // Player is mostly out of view — show best comment/sidebar/description
      this._hoverLocked = false;
      if (!this._ytScrolling) {
        this._ytScrolling = true;
        this._showBest();
      }
      clearTimeout(this._ytScrollTimer);
      this._ytScrollTimer = setTimeout(() => {
        this._ytScrolling = false;
        this._showBest();
      }, 150);
    }

    _stopYouTube() {
      this.ytHandler?.destroy();
      this.ytHandler = null;
      if (this._ytNavHandler) {
        document.removeEventListener('yt-navigate-finish', this._ytNavHandler);
        this._ytNavHandler = null;
      }
      if (this._ytUrlCheck) {
        clearInterval(this._ytUrlCheck);
        this._ytUrlCheck = null;
      }
      if (this._ytPageScrollHandler) {
        window.removeEventListener('scroll', this._ytPageScrollHandler);
        this._ytPageScrollHandler = null;
      }
      clearTimeout(this._ytScrollTimer);
      this._ytNavDebounce = false;
    }

    // ---- General pages ----
    _initPage() {
      this.videoHandler = new VideoHandler(this.overlay, this.translator, this.settings);
      this.videoHandler.init();

      // Show immediately, then retry while page finishes loading
      this._showBest();
      setTimeout(() => this._showBest(), 150);
      setTimeout(() => this._showBest(), 600);
      setTimeout(() => this._showBest(), 1500);

      // Click-to-translate
      this._boundClick = this._onClick.bind(this);
      document.addEventListener('click', this._boundClick, true);

      // Hover-to-translate (lower priority than click)
      this._boundHover = this._onHover.bind(this);
      document.addEventListener('mouseover', this._boundHover, true);

      // Scroll — leading edge (instant) + trailing edge (after settle)
      this._boundScroll = this._onScroll.bind(this);
      window.addEventListener('scroll', this._boundScroll, { passive: true });

      // Instagram: also listen for scroll inside the comment container
      // (Instagram comments scroll in their own container, not the window)
      this._initIGScroll();

      // SPA navigation (pushState/popState, hash changes)
      this._boundNav = () => {
        this._clickLocked = false;
        this._hoverLocked = false;
        clearTimeout(this._hoverTimer);
        this.overlay?.hide();
        this.overlay?.hideCloseBtn();
        this._clearHighlight();
        this.lastText = '';
        setTimeout(() => this._showBest(), 100);
        setTimeout(() => this._showBest(), 500);
      };
      window.addEventListener('popstate', this._boundNav);
      window.addEventListener('hashchange', this._boundNav);

      // Re-extract when tab becomes visible
      this._boundVisibility = () => {
        if (!document.hidden) {
          this.lastText = '';
          this._showBest();
        }
      };
      document.addEventListener('visibilitychange', this._boundVisibility);

      // DOM mutations (infinite scroll, SPA content updates)
      // Throttle gate: skip callback entirely when a timer is already pending
      this.domObserver = new MutationObserver(() => {
        if (this._domTimer) return; // Already pending — skip
        this._domTimer = setTimeout(() => {
          this._domTimer = null;
          this._showBest();
        }, 300);
      });
      const mainEl = document.querySelector('main') || document.querySelector('#content') || document.body;
      this.domObserver.observe(mainEl, { childList: true, subtree: true });
    }

    _stopPage() {
      this.videoHandler?.destroy();
      this.videoHandler = null;
      this.domObserver?.disconnect();
      this.domObserver = null;
      if (this._boundScroll) window.removeEventListener('scroll', this._boundScroll);
      if (this._boundClick) document.removeEventListener('click', this._boundClick, true);
      if (this._boundHover) document.removeEventListener('mouseover', this._boundHover, true);
      clearTimeout(this._hoverTimer);
      this._hoverLocked = false;
      if (this._boundNav) {
        window.removeEventListener('popstate', this._boundNav);
        window.removeEventListener('hashchange', this._boundNav);
      }
      if (this._boundVisibility) document.removeEventListener('visibilitychange', this._boundVisibility);
      this._stopIGScroll();
      this._clearHighlight();
      this._scrolling = false;
      this.lastText = '';
    }

    // ---- Smart text extraction helpers ----

    // Get visible text from element, excluding hidden/invisible/non-content nodes
    _getVisibleText(el) {
      // Walk the DOM to collect text, skipping non-visible/non-content nodes.
      // Avoids expensive getComputedStyle on every node — uses fast checks first,
      // only falling back to computed style for elements that look suspicious.
      let text = '';
      const walk = (node) => {
        if (node.nodeType === 3) { text += node.textContent; return; }
        if (node.nodeType !== 1) return; // only process element nodes
        const tag = node.tagName?.toLowerCase();
        // Skip script/style/template/svg (SVG can contain obfuscated text nodes)
        if (tag === 'script' || tag === 'style' || tag === 'noscript' ||
            tag === 'template' || tag === 'svg') return;
        // Skip aria-hidden elements (screen reader text, obfuscated anti-scrape decorations)
        if (node.getAttribute('aria-hidden') === 'true') return;

        if (node !== el) {
          // Fast check: inline style patterns for hiding (Facebook anti-scrape, etc.)
          const inlineStyle = node.getAttribute('style') || '';
          if (/display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0/i.test(inlineStyle)) return;
          // Overflow hidden + 0-height inline style (obfuscated containers)
          if (/overflow\s*:\s*hidden/i.test(inlineStyle) && /height\s*:\s*0/i.test(inlineStyle)) return;

          // Fast check: zero-size elements with no offset (hidden via display:none etc.)
          if (tag !== 'span' && tag !== 'br' && tag !== 'wbr' && tag !== 'a') {
            if (node.offsetParent === null && node.offsetHeight === 0 && node.offsetWidth === 0) {
              const s = node.style;
              if (s && (s.display === 'none' || s.visibility === 'hidden')) return;
              // getComputedStyle only for zero-size block elements (likely truly hidden)
              try {
                const cs = getComputedStyle(node);
                if (cs.display === 'none' || cs.visibility === 'hidden') return;
              } catch {}
            }
          }

          // Screen-reader-only detection: only check elements that have sr-only class hints
          // or are positioned absolute/fixed with suspicious inline styles
          const cls = typeof node.className === 'string' ? node.className : '';
          if (cls && /\b(sr-only|visually-hidden|screen-reader|clip-hide|a11y-hidden|assistive-text)\b/i.test(cls)) {
            return; // Known sr-only class names — skip
          }
          // Check for sr-only inline patterns: position:absolute + clip or tiny dimensions
          if (/position\s*:\s*(absolute|fixed)/i.test(inlineStyle)) {
            if (/clip\s*:/i.test(inlineStyle) || /clip-path\s*:/i.test(inlineStyle)) return;
            if (/width\s*:\s*1px/i.test(inlineStyle) && /height\s*:\s*1px/i.test(inlineStyle)) return;
            if (/left\s*:\s*-\d{4,}/i.test(inlineStyle) || /top\s*:\s*-\d{4,}/i.test(inlineStyle)) return;
          }
        }

        for (const child of node.childNodes) walk(child);
      };
      walk(el);
      return text.trim();
    }

    // Detect text that looks like code, obfuscated strings, or garbled non-language
    _looksLikeCode(text) {
      if (!text || text.length < 10) return false;

      // 1. JavaScript/CSS code patterns
      if (text.length >= 20) {
        const codeSignals = (text.match(/===|!==|=>|\|\||;\s*\w|\.querySelector|\.addEventListener|\.className|null;|undefined;|function\s*\(|const\s+\w+=|let\s+\w+=|var\s+\w+=|\}\s*\)|\btypeof\b|\bwindow\./g) || []).length;
        if (codeSignals >= 2) return true;
      }

      // 2. Obfuscated/garbled strings (Facebook anti-scrape, CSS class names)
      // Tokens with mixed letters+digits in non-word patterns like "am7a892f6atc49"
      const tokens = text.split(/\s+/);
      let garbledTokens = 0;
      for (const tok of tokens) {
        if (tok.length < 5) continue;
        const hasLetters = /[a-zA-Z]/.test(tok);
        const hasDigits = /\d/.test(tok);
        if (hasLetters && hasDigits) {
          const digitRatio = (tok.match(/\d/g) || []).length / tok.length;
          // Significant digit mixing in a "word" = garbled (not dates, not "24px")
          if (digitRatio > 0.15 && digitRatio < 0.85 && tok.length > 6) garbledTokens++;
        }
        // Very long tokens with no vowels or very few = likely hashed/obfuscated
        if (tok.length > 10 && hasLetters) {
          const vowelRatio = (tok.match(/[aeiouAEIOU]/g) || []).length / tok.length;
          if (vowelRatio < 0.1) garbledTokens++;
        }
      }
      if (garbledTokens >= 2) return true;
      // Single garbled token that IS the whole text
      if (garbledTokens >= 1 && tokens.length <= 2) return true;

      // 3. Long string with no spaces at all (likely a CSS class, hash, or encoded string)
      if (text.length > 20 && !text.includes(' ') && !/^https?:\/\//.test(text)) return true;

      return false;
    }

    // Detect concatenated UI text (action buttons + content mashed together)
    _hasConcatenatedActions(text) {
      if (!text) return false;
      const t = text.trim();

      // 1. Social actions concatenated: LikeCommentShareSave etc.
      if (/(?:Like|Comment|Share|Save|Send|Reply|Repost|Follow)\d*(?:Like|Comment|Share|Save|Send|Reply|Repost|Follow|[A-Z])/i.test(t)) return true;

      // 2. YouTube: Tap to unmute2xSearchInfoShopping etc.
      if (/(?:Search|Info|Shopping|Subscribe|Upcoming|Cancel|Play now)\w*(?:Search|Info|Shopping|Subscribe|Upcoming|Cancel|Play now|[A-Z])/i.test(t)) return true;

      // 3. Navigation/UI words concatenated without spaces: PreviousNext, ToolsPro, etc.
      // Two or more UI words stuck together as a single "word" (no spaces)
      const uiWordPattern = /^(?:Previous|Next|Back|Forward|Close|Open|Cancel|Submit|Loading|Search|Filter|Sort|Menu|Tools|Settings|Options|More|Less|View|Edit|Delete|Remove|Add|New|Save|Undo|Redo|Refresh|Home|Up|Down|Left|Right|First|Last|Show|Hide|Toggle|Select|Clear|Reset|Apply|Done|Skip|Play|Pause|Stop|Mute|Unmute|Pro|Plus|Premium|Free|Upgrade|Sign|Log|Login|Logout|Profile|Account|Help|Info|About|Contact|Privacy|Terms|Accept|Decline|Dismiss|Learn|Read|Watch|Listen|Download|Upload|Import|Export|Copy|Paste|Print|Zoom|Expand|Collapse|Minimize|Maximize|Fullscreen|Exit|Shared|Public|Friends|Everyone){2,}$/i;
      // Check each whitespace-separated token
      for (const word of t.split(/\s+/)) {
        if (word.length > 5 && uiWordPattern.test(word)) return true;
      }

      // 4. Generic: 2+ CamelCase words jammed together (PreviousNext, ToolsPro)
      const camelRuns = t.match(/[A-Z][a-z]{2,}(?=[A-Z])/g);
      if (camelRuns && camelRuns.length >= 2) {
        // If the text is ONLY the concatenated words (no surrounding sentence), reject it
        const joined = t.replace(/\s+/g, '');
        if (joined.length < 30) return true;
      }
      // Still reject 3+ CamelCase even in longer text
      if (camelRuns && camelRuns.length >= 3) return true;

      return false;
    }

    // Detect text that is metadata, UI labels, or non-content (not worth translating)
    _isNonContentText(text) {
      if (!text) return true;
      const t = text.trim();
      if (t.length < 3) return true;

      // Exact-match known metadata/UI labels (case insensitive)
      const metadataPattern = /^(shared with (public|friends|everyone|friends of friends)|public(ly)?|friends only|only me|see more|see less|view all|load more|show more|show less|edited|pinned|sponsored|promoted|suggested for you|suggested|recommended|verified|following|follow|unfollow|liked?|comment|share|send|saved?|reply|retweet|repost|quote|bookmark|report|block|mute|hide|not interested|turn on notifications|see translation|translate tweet|translated by|original|view translation|view original|most relevant|newest first|all comments|people also viewed|you might like|add a comment|write a comment|log in|sign up|sign in|create account|learn more|read more|view more|shop now|see all|sell|buy|post|x|×|\.\.\.)$/i;
      if (metadataPattern.test(t)) return true;

      // Starts with "Shared with" (Facebook privacy label variants)
      if (/^shared with\b/i.test(t) && t.length < 40) return true;

      // Engagement metrics patterns: "1.7K", "123 shares", "44 comments"
      if (/^\d[\d.,KkMmBb]*\s*(comments?|shares?|likes?|views?|reactions?|replies?|retweets?|reposts?|followers?|following)?\s*$/i.test(t)) return true;

      // Timestamp-like short text: "1h", "2d", "3w", "5m ago", "Just now", "Yesterday"
      if (/^(\d+[smhdw]|just now|yesterday|today|\d+ (?:seconds?|minutes?|hours?|days?|weeks?|months?|years?) ago)$/i.test(t)) return true;

      return false;
    }

    // Clean extracted text: strip bare URLs, excess whitespace
    _cleanExtractedText(text) {
      if (!text) return text;
      return text
        .replace(/https?:\/\/\S+/g, '')
        .replace(/www\.\S+/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    }

    // Find the most specific child element near cursor with reasonable text
    _findBestChildNearPoint(el, x, y) {
      const selectors = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, a, span, yt-formatted-string, [dir="auto"]';
      const children = el.querySelectorAll(selectors);
      if (children.length === 0) return null;

      let bestChild = null, bestDist = Infinity;
      for (const child of children) {
        // Prefer the title attribute if present (e.g. YouTube #video-title)
        const titleAttr = child.getAttribute('title');
        const cText = (titleAttr && titleAttr.length >= 5) ? titleAttr.trim() : this._getVisibleText(child);
        if (!cText || cText.length < 5 || cText.length > 5000) continue;
        if (!/[a-zA-Z]{2,}/.test(cText)) continue;
        if (this._looksLikeCode(cText)) continue;
        if (this.extractor._isExcluded(child)) continue;
        if (this.extractor._isMostlyUsernames(cText)) continue;

        const rect = child.getBoundingClientRect();
        if (rect.height === 0 || rect.width === 0) continue;

        // Distance weighted toward vertical proximity
        const cy = (rect.top + rect.bottom) / 2;
        const cx = (rect.left + rect.right) / 2;
        const dist = Math.abs(cy - y) * 2 + Math.abs(cx - x) * 0.5;
        if (dist < bestDist) {
          bestDist = dist;
          bestChild = { el: child, text: cText.substring(0, 1500) };
        }
      }

      // If best child's text is very long, extract sentences near cursor
      if (bestChild && bestChild.text.length > 1500) {
        const sentences = this._extractNearbySentences(bestChild.el, x, y);
        if (sentences) bestChild.text = sentences;
      }

      return bestChild;
    }

    // Extract sentences near cursor from long text block (up to 1500 chars)
    _extractNearbySentences(el, x, y) {
      const fullText = this._cleanExtractedText(this._getVisibleText(el));
      if (!fullText || fullText.length < 10) return null;
      if (fullText.length <= 1500) return fullText;

      const sentences = fullText.match(/[^.!?\n]+(?:[.!?\n]+|\s*$)/g) || [fullText];
      if (sentences.length <= 1) return fullText.substring(0, 1500);

      // Try to find cursor position in text using caretRangeFromPoint
      let charOffset = -1;
      if (x != null && y != null) {
        try {
          const range = document.caretRangeFromPoint(x, y);
          if (range && el.contains(range.startContainer)) {
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            let total = 0, node;
            while ((node = walker.nextNode())) {
              if (node === range.startContainer) {
                charOffset = total + range.startOffset;
                break;
              }
              total += node.textContent.length;
            }
          }
        } catch {}
      }

      // Fallback: estimate from viewport center
      if (charOffset < 0) {
        const rect = el.getBoundingClientRect();
        const vpCenter = window.innerHeight / 2;
        const relY = Math.max(0, Math.min(1, (vpCenter - rect.top) / Math.max(rect.height, 1)));
        charOffset = Math.floor(relY * fullText.length);
      }

      // Find sentence containing cursor and grab surrounding sentences up to 1500 chars
      let running = 0, bestIdx = 0;
      for (let i = 0; i < sentences.length; i++) {
        if (running + sentences[i].length > charOffset) { bestIdx = i; break; }
        running += sentences[i].length;
        bestIdx = i;
      }

      // Expand outward from bestIdx to gather more sentences up to limit
      let startIdx = bestIdx, endIdx = bestIdx + 1;
      let totalLen = sentences[bestIdx].length;
      while (totalLen < 1500) {
        let expanded = false;
        if (startIdx > 0 && totalLen + sentences[startIdx - 1].length <= 1500) {
          startIdx--;
          totalLen += sentences[startIdx].length;
          expanded = true;
        }
        if (endIdx < sentences.length && totalLen + sentences[endIdx].length <= 1500) {
          totalLen += sentences[endIdx].length;
          endIdx++;
          expanded = true;
        }
        if (!expanded) break;
      }

      const result = sentences.slice(startIdx, endIdx).join('').trim();
      return result.substring(0, 1500) || fullText.substring(0, 1500);
    }

    _onScroll() {
      // Scrolling releases hover lock only — click-lock persists through scroll
      this._hoverLocked = false;

      // If click-locked, don't auto-extract — keep locked text visible
      if (this._clickLocked) return;

      // Leading edge: fire immediately on first scroll tick
      if (!this._scrolling) {
        this._scrolling = true;
        this._showBest();
      }
      // Trailing edge: fire again once scrolling stops
      clearTimeout(this.scrollTimer);
      this.scrollTimer = setTimeout(() => {
        this._scrolling = false;
        this._showBest();
      }, 150);
    }

    // ---- Shared: extract text from an element, drilling down for specificity ----
    _smartExtract(el, x, y, lenient = false) {
      // Reddit: if inside a shreddit-comment, extract that specific comment's content
      // Return full text (up to 1500 chars) — visual truncation handled by "see more" UI
      const rc = el.closest?.('shreddit-comment');
      if (rc) {
        // :scope > ensures we get THIS comment's content, not a nested reply's
        const ce = rc.querySelector(':scope > [slot="comment"] .md') ||
                   rc.querySelector(':scope > [slot="comment"]') ||
                   rc.querySelector(':scope > .md');
        if (ce) {
          const t = this._getVisibleText(ce);
          if (t && t.length >= 5 && /[a-zA-Z]{2,}/.test(t) && !this._looksLikeCode(t)) {
            let cleaned = this._cleanExtractedText(t);
            if (cleaned && cleaned.length >= 5) {
              return { targetEl: ce, cleaned: cleaned.substring(0, 1500) };
            }
          }
        }
      }

      // Reddit feed: if on/inside a shreddit-post, extract post title or body
      // Return full text (up to 1500 chars) — visual truncation handled by "see more" UI
      const rp = el.closest?.('shreddit-post') ||
                 (el.tagName?.toLowerCase() === 'shreddit-post' ? el : null);
      if (rp && !rc) {
        const postTitle = rp.getAttribute('post-title');
        // Check if there's a post body and cursor is over it
        const bodyEl = rp.querySelector('[slot="text-body"] .md') ||
                       rp.querySelector('[slot="text-body"]');
        if (bodyEl) {
          const bodyRect = bodyEl.getBoundingClientRect();
          if (y >= bodyRect.top - 10 && y <= bodyRect.bottom + 10) {
            const t = this._getVisibleText(bodyEl);
            if (t && t.length >= 5 && /[a-zA-Z]{2,}/.test(t) && !this._looksLikeCode(t)) {
              let cleaned = this._cleanExtractedText(t);
              if (cleaned && cleaned.length >= 5) {
                return { targetEl: bodyEl, cleaned: cleaned.substring(0, 1500) };
              }
            }
          }
        }
        // Default: use the clean post-title attribute
        if (postTitle && postTitle.length >= 5 && /[a-zA-Z]{2,}/.test(postTitle)) {
          const titleEl = rp.querySelector('[slot="title"]') ||
                          rp.querySelector('[data-testid="post-title"]') ||
                          rp.querySelector('a[id*="title"]');
          return { targetEl: titleEl || rp, cleaned: this._cleanExtractedText(postTitle) };
        }
      }

      // For links and headings, use the element's own text even if short (≥2 chars).
      // This prevents walking up to a parent container that includes extra text
      // (e.g. hovering "Cats" link on Google picking up the breadcrumb below it).
      const tag = el.tagName?.toLowerCase();
      if (tag === 'a' || tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
        // Skip links/headings inside page-level nav/header (not article-level)
        if (!lenient) {
          const navParent = el.closest('nav, header, footer');
          if (navParent && !navParent.closest('article, main, [role="main"], shreddit-post, shreddit-comment')) return null;
        }
        const linkText = this._getVisibleText(el);
        if (linkText && linkText.length >= 2 && /[a-zA-Z]{2,}/.test(linkText) && !this._looksLikeCode(linkText)) {
          const cleaned = this._cleanExtractedText(linkText);
          if (cleaned && cleaned.length >= 2 && cleaned.length <= 300 && !this._hasConcatenatedActions(cleaned)) {
            return { targetEl: el, cleaned };
          }
        }
      }

      // Check title attribute (YouTube #video-title uses title attr for clean text)
      const titleAttr = el.getAttribute?.('title');
      if (titleAttr && titleAttr.length >= 5 && titleAttr.length <= 300 && /[a-zA-Z]{2,}/.test(titleAttr)) {
        return { targetEl: el, cleaned: this._cleanExtractedText(titleAttr) };
      }

      const rawText = this._getVisibleText(el);
      if (!rawText || rawText.length < 5 || !/[a-zA-Z]{2,}/.test(rawText)) return null;
      // Reject code/metadata (script content from web components)
      if (this._looksLikeCode(rawText)) return null;
      if (!lenient) {
        if (this.extractor._isExcluded(el) || this.extractor._isMostlyUsernames(rawText)) return null;
      } else {
        // Even in lenient mode, skip obvious UI elements
        const tag = el.tagName?.toLowerCase();
        if (tag === 'button' || tag === 'nav' || tag === 'aside' || tag === 'footer' ||
            tag === 'script' || tag === 'style' || tag === 'noscript') return null;
        if (el.id === 'ss-overlay') return null;
      }

      let targetEl = el;
      let cleaned;

      if (rawText.length <= 1500 && !this._hasConcatenatedActions(rawText)) {
        // Moderate text without concatenated UI — use as-is after cleaning
        cleaned = this._cleanExtractedText(rawText);
      } else {
        // Very long text or concatenated action text — drill down to find specific child
        const child = this._findBestChildNearPoint(el, x, y);
        if (child) {
          targetEl = child.el;
          cleaned = this._cleanExtractedText(child.text);
        } else {
          // No specific child — extract nearby sentences
          cleaned = this._extractNearbySentences(el, x, y);
        }
      }

      if (!cleaned || cleaned.length < 5 || this._looksLikeCode(cleaned)) return null;
      cleaned = cleaned.substring(0, 1500);
      return { targetEl, cleaned };
    }

    // Check if the clicked element is interactive (button, link, tab, etc.)
    // Walks from the click target up to the text source, checking each ancestor.
    _isInteractiveEl(clickTarget, textSourceEl) {
      let node = clickTarget;
      for (let d = 0; node && d < 8; d++) {
        const tag = node.tagName?.toLowerCase();
        // Native interactive elements
        if (tag === 'a' || tag === 'button' || tag === 'select' ||
            tag === 'input' || tag === 'textarea' || tag === 'label' ||
            tag === 'summary' || tag === 'details' || tag === 'option') return true;
        // ARIA interactive roles
        const role = node.getAttribute?.('role');
        if (role === 'button' || role === 'tab' || role === 'link' ||
            role === 'menuitem' || role === 'option' || role === 'switch' ||
            role === 'checkbox' || role === 'radio' || role === 'combobox' ||
            role === 'listbox' || role === 'searchbox' || role === 'textbox' ||
            role === 'spinbutton' || role === 'slider' || role === 'gridcell') return true;
        // Contenteditable (text inputs)
        if (node.isContentEditable) return true;
        // Elements with tabindex or onclick are interactive
        if (node.hasAttribute?.('tabindex') || node.hasAttribute?.('onclick')) return true;
        // Cursor:pointer is a strong signal of clickability
        try {
          if (node.nodeType === 1) {
            const cs = window.getComputedStyle(node);
            if (cs.cursor === 'pointer') return true;
          }
        } catch {}
        // Stop walking once we reach the text source element
        if (node === textSourceEl) break;
        node = node.parentElement;
      }
      return false;
    }

    // ---- Close overlay (dismiss click-lock) ----
    _onCloseOverlay() {
      this._clickLocked = false;
      this._hoverLocked = false;
      clearTimeout(this._hoverTimer);
      this._clearHighlight();
      this.overlay.hideCloseBtn();
      this.lastText = '';
      this._showBest(); // Resume auto-extraction
    }

    // ---- Click to translate (highest priority — overrides hover and auto) ----
    _onClick(e) {
      if (this._isYTWatch()) return;
      // When collapsed, subtitles are disabled — ignore all clicks
      if (this.overlay?._collapsed) return;

      // Click always overrides hover
      this._hoverLocked = false;
      clearTimeout(this._hoverTimer);

      // Walk up from click target to find meaningful text
      let el = e.target;
      let depth = 0;
      while (el && el !== document.body && depth < 10) {
        // Skip our own overlay elements
        if (el.id === 'ss-overlay' || el.id === 'ss-translation' || el.id === 'ss-original' ||
            el.id === 'ss-tts-btn' || el.id === 'ss-tts-row' ||
            el.id === 'ss-see-more-btn' || el.id === 'ss-close-btn' ||
            el.id === 'ss-collapse-btn') return;

        const result = this._smartExtract(el, e.clientX, e.clientY);
        if (result) {
          // Check if the clicked element is interactive (button, link, tab, etc.)
          // If so, translate the text but don't lock or show the close button
          const interactive = this._isInteractiveEl(e.target, result.targetEl);
          // Only lock and show (x) for long static text (paragraphs, descriptions).
          // Short text or interactive elements just translate without locking.
          const isLongStatic = !interactive && result.cleaned.length >= 40;
          if (isLongStatic) {
            // Long static text — lock and show close button
            this._clickLocked = true;
            this._highlightElement(result.targetEl);
            this.overlay.showCloseBtn(result.targetEl);
          }
          if (result.cleaned !== this.lastText) {
            this.lastText = result.cleaned;
            this._translateText(result.cleaned);
          }
          return;
        }
        el = el.parentElement;
        depth++;
      }

      // Clicked on non-text area — unlock so auto-extraction resumes
      this._clickLocked = false;
      this.overlay.hideCloseBtn();
      this._clearHighlight();
      this.lastText = '';
      this._showBest();
    }

    // ---- Hover to translate — works on any page, shows preview ----
    // Hover does NOT override click-lock: if text is locked, hover is ignored
    _onHover(e) {
      if (this._isYTWatch()) return;
      // When collapsed, subtitles are disabled — ignore hovers
      if (this.overlay?._collapsed) return;

      // If text is click-locked, ignore hover — user must dismiss lock first
      if (this._clickLocked) return;

      // Early exclusion: if the hover target is directly inside a page-level
      // header/nav/footer (not article-level), skip to avoid screen-reader text.
      // Only check up to 5 ancestors to avoid being too aggressive on content.
      {
        let n = e.target, d = 0;
        while (n && n !== document.body && d < 5) {
          const t = n.tagName?.toLowerCase();
          if (t === 'header' || t === 'nav' || t === 'footer') {
            // Allow if inside an article or main (content area, not page chrome)
            if (!n.closest('article, main, [role="main"], shreddit-post, shreddit-comment')) {
              this._hoverLocked = false;
              return;
            }
            break; // Inside content — allow
          }
          n = n.parentElement;
          d++;
        }
      }

      // Immediately block _showBest() so in-flight auto-translations don't
      // overwrite the hover result (the debounced callback sets it more permanently)
      this._hoverLocked = true;

      // Debounce rapid mouseover events
      clearTimeout(this._hoverTimer);
      this._hoverTimer = setTimeout(() => {
        if (this._clickLocked) return; // Re-check after debounce

        // Walk up from hover target to find meaningful text
        let el = e.target;
        let depth = 0;
        while (el && el !== document.body && depth < 8) {
          // Skip our own overlay elements
          if (el.id === 'ss-overlay' || el.id === 'ss-translation' || el.id === 'ss-original' ||
              el.id === 'ss-tts-btn' || el.id === 'ss-tts-row' ||
              el.id === 'ss-see-more-btn' || el.id === 'ss-close-btn' ||
              el.id === 'ss-collapse-btn') return;

          const result = this._smartExtract(el, e.clientX, e.clientY);
          if (result) {
            if (result.cleaned === this.lastText) return;
            this.lastText = result.cleaned;
            this._hoverLocked = true;
            this._highlightElement(result.targetEl);
            this._translateText(result.cleaned);
            return;
          }
          el = el.parentElement;
          depth++;
        }

        // Fallback: retry with lenient mode (skip exclusion checks)
        // This catches text that _isExcluded over-filters (Instagram captions, etc.)
        el = e.target;
        depth = 0;
        while (el && el !== document.body && depth < 4) {
          if (el.id === 'ss-overlay' || el.id === 'ss-translation' || el.id === 'ss-original' ||
              el.id === 'ss-tts-btn' || el.id === 'ss-tts-row' ||
              el.id === 'ss-see-more-btn' || el.id === 'ss-close-btn' ||
              el.id === 'ss-collapse-btn') return;
          const result = this._smartExtract(el, e.clientX, e.clientY, true);
          if (result) {
            if (result.cleaned === this.lastText) return;
            this.lastText = result.cleaned;
            this._hoverLocked = true;
            this._highlightElement(result.targetEl);
            this._translateText(result.cleaned);
            return;
          }
          el = el.parentElement;
          depth++;
        }
      }, 120);
    }

    // ---- Instagram: scroll listener for comment container ----
    _initIGScroll() {
      if (!window.location.hostname.includes('instagram.com')) return;
      // Instagram's comment section scrolls inside its own container (not the window).
      // Find it after a short delay (Instagram loads content dynamically).
      const findContainer = () => {
        // The scrollable comment list — typically a ul or div with overflow scroll inside the dialog/article
        const candidates = document.querySelectorAll(
          '[role="dialog"] ul, article ul, [role="dialog"] [style*="overflow"]'
        );
        for (const el of candidates) {
          const style = getComputedStyle(el);
          if (style.overflowY === 'auto' || style.overflowY === 'scroll' ||
              el.scrollHeight > el.clientHeight + 50) {
            this._igScrollEl = el;
            this._igScrollHandler = () => this._onScroll();
            el.addEventListener('scroll', this._igScrollHandler, { passive: true });
            return;
          }
        }
        // Also check parent containers
        const dialogs = document.querySelectorAll('[role="dialog"] > div > div, article > div > div');
        for (const el of dialogs) {
          const style = getComputedStyle(el);
          if (style.overflowY === 'auto' || style.overflowY === 'scroll' ||
              el.scrollHeight > el.clientHeight + 50) {
            this._igScrollEl = el;
            this._igScrollHandler = () => this._onScroll();
            el.addEventListener('scroll', this._igScrollHandler, { passive: true });
            return;
          }
        }
      };
      // Try immediately, then retry as Instagram loads dynamically
      findContainer();
      setTimeout(() => { if (!this._igScrollEl) findContainer(); }, 1000);
      setTimeout(() => { if (!this._igScrollEl) findContainer(); }, 3000);
    }

    _stopIGScroll() {
      if (this._igScrollEl && this._igScrollHandler) {
        this._igScrollEl.removeEventListener('scroll', this._igScrollHandler);
      }
      this._igScrollEl = null;
      this._igScrollHandler = null;
    }

    // ---- Extract and show best visible text ----
    async _showBest() {
      if (this._clickLocked || this._hoverLocked) return; // Don't override user interaction
      if (this.overlay?._collapsed) return; // Subtitles disabled while collapsed
      const result = this.extractor.extractSingle();
      if (!result || result.text === this.lastText) return;
      this.lastText = result.text;

      this._highlightElement(result.element);
      this._translateText(result.text);
    }

    async _translateText(text) {
      const gen = ++this._translateGen;
      const tr = await this.translator.translate(text, this.settings.targetLang);
      // Only show if this is still the latest translation request (prevents stale
      // translations from _showBest or earlier hovers overwriting current result)
      if (tr && gen === this._translateGen) {
        this.overlay.show(tr, this.settings.showOriginal ? text : '');
      }
    }

    // ---- Highlight source element ----
    // Uses inline styles (not CSS class) for maximum reliability — works through
    // Shadow DOM boundaries and overrides any page CSS specificity.
    _highlightElement(el) {
      this._clearHighlight();
      if (this.settings.highlightMode && el) {
        // Store originals so we can restore them
        this._prevOutline = el.style.outline;
        this._prevOutlineOffset = el.style.outlineOffset;
        this._prevBorderRadius = el.style.borderRadius;
        el.style.outline = '1px solid #F1D871';
        el.style.outlineOffset = '2px';
        el.style.borderRadius = '2px';
        this._highlightedEl = el;
      }
    }

    _clearHighlight() {
      if (this._highlightedEl) {
        this._highlightedEl.style.outline = this._prevOutline || '';
        this._highlightedEl.style.outlineOffset = this._prevOutlineOffset || '';
        this._highlightedEl.style.borderRadius = this._prevBorderRadius || '';
        this._highlightedEl = null;
      }
    }

    // ---- Settings ----
    _loadSettings() {
      return new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ type: 'getSettings' }, (resp) => {
            if (!chrome.runtime.lastError && resp) Object.assign(this.settings, resp);
            resolve();
          });
        } catch { resolve(); }
      });
    }

    _listenSettings() {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type !== 'settingsUpdated') return;
        const wasOn = this.settings.enabled;
        const oldLang = this.settings.targetLang;
        Object.assign(this.settings, msg.settings);
        this.overlay?.updateSettings(this.settings);

        // Turned off
        if (!this.settings.enabled) {
          this.overlay?._stopSpeech();
          this.overlay?.hide();
          this.overlay?.hideCloseBtn();
          this._clickLocked = false;
          this._clearHighlight();
          this._stopYouTube();
          this._stopPage();
          return;
        }

        // Turned on from off
        if (!wasOn) {
          this._boot();
          return;
        }

        // Stayed on — react to specific changes
        if (!this.settings.highlightMode) this._clearHighlight();

        // Language changed → clear translation cache and re-translate
        if (oldLang !== this.settings.targetLang) {
          this.translator.cache.clear();
          this.translator.pending.clear();
          this.lastText = '';
          if (this._isYTWatch()) {
            // Destroy old handler but keep nav watchers alive
            this.ytHandler?.destroy();
            this.ytHandler = new YouTubeHandler(this.overlay, this.translator, this.settings);
            this.ytHandler.init();
            this.ytHandler.handleFullscreen();
          } else {
            this._showBest();
          }
          return;
        }

        // Any other change (fontSize, showOriginal, highlight, background) → refresh
        this.lastText = '';
        if (!this._isYTWatch()) this._showBest();
      });
    }
  }

  // ========================================================
  // BOOT
  // ========================================================
  if (document.body) {
    new ClassicSubtitles().start();
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      new ClassicSubtitles().start();
    });
  }
})();
