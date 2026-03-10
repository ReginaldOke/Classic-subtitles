// ============================================
// CLASSIC SUBTITLES — Content Script
// Single most-important text extraction per viewport
// YouTube caption sync via YT's own translation API
// Highlight mode, click-to-translate
// ============================================
(function () {
  'use strict';
  if (window.__classicSubtitlesLoaded) return;
  window.__classicSubtitlesLoaded = true;

  // ========================================================
  // SHARED UTILITY FUNCTIONS
  // Pure functions used by TextExtractor, ClassicSubtitles, etc.
  // ========================================================

  function _getVisibleText(el) {
    let text = '';
    const walk = (node) => {
      if (node.nodeType === 3) { text += node.textContent; return; }
      if (node.nodeType !== 1) return;
      const tag = node.tagName?.toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'noscript' ||
          tag === 'template' || tag === 'svg') return;
      if (node.getAttribute('aria-hidden') === 'true') return;
      if (node !== el) {
        const inlineStyle = node.getAttribute('style') || '';
        if (/display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0/i.test(inlineStyle)) return;
        if (/overflow\s*:\s*hidden/i.test(inlineStyle) && /height\s*:\s*0/i.test(inlineStyle)) return;
        if (tag !== 'span' && tag !== 'br' && tag !== 'wbr' && tag !== 'a') {
          if (node.offsetParent === null && node.offsetHeight === 0 && node.offsetWidth === 0) {
            const s = node.style;
            if (s && (s.display === 'none' || s.visibility === 'hidden')) return;
            try {
              const cs = getComputedStyle(node);
              if (cs.display === 'none' || cs.visibility === 'hidden') return;
            } catch {}
          }
        }
        const cls = typeof node.className === 'string' ? node.className : '';
        if (cls && /\b(sr-only|visually-hidden|screen-reader|clip-hide|a11y-hidden|assistive-text)\b/i.test(cls)) {
          return;
        }
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

  function _looksLikeCode(text) {
    if (!text || text.length < 10) return false;
    if (text.length >= 20) {
      const codeSignals = (text.match(/===|!==|=>|\|\||;\s*\w|\.querySelector|\.addEventListener|\.className|null;|undefined;|function\s*\(|const\s+\w+=|let\s+\w+=|var\s+\w+=|\}\s*\)|\btypeof\b|\bwindow\./g) || []).length;
      if (codeSignals >= 2) return true;
    }
    const tokens = text.split(/\s+/);
    let garbledTokens = 0;
    for (const tok of tokens) {
      if (tok.length < 5) continue;
      // Skip tokens that look like financial/unit notation (e.g. $48K/year, ~$30K/year, 0.75%)
      if (/^[~$€£¥₹]/.test(tok) || /\d[KkMmBb%]/.test(tok) || /\/\w{2,}$/.test(tok)) continue;
      const hasLetters = /[a-zA-Z]/.test(tok);
      const hasDigits = /\d/.test(tok);
      if (hasLetters && hasDigits) {
        const digitRatio = (tok.match(/\d/g) || []).length / tok.length;
        if (digitRatio > 0.15 && digitRatio < 0.85 && tok.length > 6) garbledTokens++;
      }
      if (tok.length > 10 && hasLetters) {
        const vowelRatio = (tok.match(/[aeiouAEIOU]/g) || []).length / tok.length;
        if (vowelRatio < 0.1) garbledTokens++;
      }
    }
    // Scale threshold with text length — long prose with a few mixed tokens isn't code
    const threshold = tokens.length > 30 ? 5 : tokens.length > 15 ? 4 : 2;
    if (garbledTokens >= threshold) return true;
    if (garbledTokens >= 1 && tokens.length <= 2) return true;
    if (text.length > 20 && !text.includes(' ') && !/^https?:\/\//.test(text)) return true;
    return false;
  }

  function _hasConcatenatedActions(text) {
    if (!text) return false;
    const t = text.trim();
    if (/(?:Like|Comment|Share|Save|Send|Reply|Repost|Follow)\d*(?:Like|Comment|Share|Save|Send|Reply|Repost|Follow|[A-Z])/i.test(t)) return true;
    if (/(?:Search|Info|Shopping|Subscribe|Upcoming|Cancel|Play now)\w*(?:Search|Info|Shopping|Subscribe|Upcoming|Cancel|Play now|[A-Z])/i.test(t)) return true;
    const uiWordPattern = /^(?:Previous|Next|Back|Forward|Close|Open|Cancel|Submit|Loading|Search|Filter|Sort|Menu|Tools|Settings|Options|More|Less|View|Edit|Delete|Remove|Add|New|Save|Undo|Redo|Refresh|Home|Up|Down|Left|Right|First|Last|Show|Hide|Toggle|Select|Clear|Reset|Apply|Done|Skip|Play|Pause|Stop|Mute|Unmute|Pro|Plus|Premium|Free|Upgrade|Sign|Log|Login|Logout|Profile|Account|Help|Info|About|Contact|Privacy|Terms|Accept|Decline|Dismiss|Learn|Read|Watch|Listen|Download|Upload|Import|Export|Copy|Paste|Print|Zoom|Expand|Collapse|Minimize|Maximize|Fullscreen|Exit|Shared|Public|Friends|Everyone){2,}$/i;
    for (const word of t.split(/\s+/)) {
      if (word.length > 5 && uiWordPattern.test(word)) return true;
    }
    const camelRuns = t.match(/[A-Z][a-z]{2,}(?=[A-Z])/g);
    if (camelRuns && camelRuns.length >= 2) {
      const joined = t.replace(/\s+/g, '');
      if (joined.length < 30) return true;
    }
    if (camelRuns && camelRuns.length >= 3) return true;
    return false;
  }

  function _isNonContentText(text) {
    if (!text) return true;
    const t = text.trim();
    if (t.length < 3) return true;
    const metadataPattern = /^(shared with (public|friends|everyone|friends of friends)|public(ly)?|friends only|only me|see more|see less|view all|load more|show more|show less|edited|pinned|sponsored|promoted|suggested for you|suggested|recommended|verified|following|follow|unfollow|liked?|comment|share|send|saved?|reply|retweet|repost|quote|bookmark|report|block|mute|hide|not interested|turn on notifications|see translation|translate tweet|translated by|original|view translation|view original|most relevant|newest first|all comments|people also viewed|you might like|add a comment|write a comment|log in|sign up|sign in|create account|learn more|read more|view more|shop now|see all|sell|buy|post|x|×|\.\.\.)$/i;
    if (metadataPattern.test(t)) return true;
    if (/^shared with\b/i.test(t) && t.length < 40) return true;
    if (/^\d[\d.,KkMmBb]*\s*(comments?|shares?|likes?|views?|reactions?|replies?|retweets?|reposts?|followers?|following)?\s*$/i.test(t)) return true;
    if (/^(\d+[smhdw]|just now|yesterday|today|\d+ (?:seconds?|minutes?|hours?|days?|weeks?|months?|years?) ago)$/i.test(t)) return true;
    if (/^view\s+(all\s+)?\d+\s+(replies|comments|likes)/i.test(t)) return true;
    if (/^view\s+replies\s*\(\d+\)/i.test(t)) return true;
    if (/^liked by\b/i.test(t) && t.length < 80) return true;
    if (/^\d+\s+[wdhms]$/i.test(t)) return true;
    if (/^(original audio|suggested post|suggested reel|audio|reel|reels?)$/i.test(t)) return true;
    if (/^followed by\b/i.test(t) && t.length < 60) return true;
    if (/^ver\s+(respuestas|comentarios|todo)\s*\(?/i.test(t)) return true;
    // Cookie consent, privacy, and legal boilerplate
    if (/\bcookies?\b/i.test(t) && /\b(policy|consent|accept|manage|preferences?|experience|analytics|tracking)\b/i.test(t)) return true;
    if (/\b(privacy policy|terms of (service|use)|cookie policy|data protection|GDPR|CCPA)\b/i.test(t) && t.length < 300) return true;
    return false;
  }

  function _cleanExtractedText(text) {
    if (!text) return text;
    return text
      .replace(/https?:\/\/\S+/g, '')
      .replace(/www\.\S+/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  // Clean Instagram caption: strip leading reaction counts (e.g. "2.3K40") and username
  // Instagram's DOM often concatenates likes, comments, username, and caption text
  function _cleanInstagramCaption(text) {
    if (!text) return text;
    let t = text;
    // Strip leading reaction counts: numbers with optional K/M suffix, concatenated
    // e.g. "2.3K40" or "1,234567" (likes+comments stuck together)
    t = t.replace(/^[\d.,]+[KkMm]?[\d.,]*[KkMm]?\s*/, '');
    // Strip leading username (single word with no spaces, possibly with emoji/verified badge)
    // Instagram usernames: letters, digits, dots, underscores — followed by caption
    t = t.replace(/^[a-zA-Z0-9._]{2,30}(?=\s*[A-Z\u00C0-\u024F\u0400-\u04FF\u4E00-\u9FFF])/, '');
    return t.replace(/\s{2,}/g, ' ').trim();
  }

  // Detect login, auth, payment, and checkout pages where subtitles should not appear
  function _isRestrictedPage() {
    const url = window.location.href.toLowerCase();
    const host = window.location.hostname.toLowerCase();
    const path = window.location.pathname.toLowerCase();

    // Restricted subdomains
    if (/^(accounts?|login|signin|sign-in|auth|checkout|pay|payment|billing)\./i.test(host)) return true;

    // Restricted URL path patterns
    const restrictedPaths = /\/(log[-_]?in|sign[-_]?in|sign[-_]?up|register|auth(enticate)?|oauth|sso|checkout|payment|billing|pay|purchase|order|cart\/checkout|account\/security|reset[-_]?password|forgot[-_]?password|2fa|mfa|verify[-_]?email|confirm[-_]?account)\b/;
    if (restrictedPaths.test(path)) return true;

    // Restricted query parameters (e.g. ?action=login)
    const search = window.location.search.toLowerCase();
    if (/[?&](action|mode|flow)=(login|signin|sign_in|signup|sign_up|checkout|payment)\b/.test(search)) return true;

    return false;
  }

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
      // Chevron icon (visible when expanded) + S icon (visible when collapsed)
      this.collapseBtn.innerHTML = `<svg class="ss-chevron-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M19.9999 8.69716C20.0023 8.56072 19.9614 8.42673 19.8826 8.31229C19.8038 8.19786 19.6906 8.1082 19.5574 8.05477C19.4243 8.00134 19.2772 7.98657 19.1351 8.01235C18.993 8.03813 18.8623 8.10329 18.7597 8.1995L11.9992 14.3603L5.23861 8.1995C5.17017 8.13574 5.08898 8.08542 4.99977 8.05145C4.91056 8.01748 4.8151 8.00054 4.7189 8.0016C4.6227 8.00266 4.52771 8.0217 4.43937 8.05763C4.35103 8.09356 4.2711 8.14566 4.20426 8.21091C4.13742 8.27615 4.08497 8.35326 4.04994 8.43775C4.01491 8.52225 3.99799 8.61246 4.00019 8.70316C4.00239 8.79386 4.02365 8.88324 4.06273 8.96614C4.10181 9.04904 4.15794 9.12381 4.22788 9.18611L11.4934 15.8071C11.6291 15.9308 11.8105 16 11.9992 16C12.1879 16 12.3692 15.9308 12.5049 15.8071L19.7705 9.18611C19.8415 9.12325 19.8984 9.04757 19.9378 8.96358C19.9772 8.87959 19.9983 8.78899 19.9999 8.69716Z" fill="#F1D871" stroke="#000000" stroke-width="1.5" paint-order="stroke fill"/></svg><svg class="ss-collapsed-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15.5095 8.53716C15.5095 7.8064 15.2681 7.25279 14.7853 6.87633C14.3026 6.49545 13.6493 6.30501 12.8256 6.30501C12.2232 6.30501 11.6807 6.40244 11.1979 6.59731C10.7152 6.79218 10.321 7.06013 10.0154 7.40116C9.70984 7.74218 9.52162 8.12971 9.45076 8.56374C9.39318 8.9269 9.43083 9.23914 9.56369 9.50045C9.69656 9.75732 9.88479 9.97212 10.1284 10.1448C10.3764 10.3131 10.6421 10.4527 10.9256 10.5634C11.209 10.6697 11.4703 10.756 11.7095 10.8225L13.0381 11.1945C13.3703 11.2875 13.7401 11.4159 14.1476 11.5798C14.555 11.7437 14.9359 11.9673 15.2902 12.2508C15.6445 12.5298 15.9147 12.8885 16.1007 13.327C16.2912 13.7655 16.3332 14.3036 16.2269 14.9413C16.1029 15.6765 15.7996 16.3408 15.3168 16.9343C14.8385 17.5278 14.2052 17.9995 13.4168 18.3493C12.6329 18.6992 11.7183 18.8742 10.6731 18.8742C9.69877 18.8742 8.87943 18.7169 8.2151 18.4025C7.55519 18.088 7.06802 17.6496 6.75357 17.0871C6.44355 16.5246 6.32397 15.8714 6.39483 15.1273H8.09552C8.05123 15.6411 8.15309 16.0663 8.40111 16.4029C8.64913 16.735 8.99458 16.983 9.43747 17.1469C9.88036 17.3063 10.372 17.3861 10.9123 17.3861C11.5412 17.3861 12.1214 17.2842 12.6528 17.0805C13.1887 16.8723 13.6316 16.5844 13.9815 16.2168C14.3358 15.8448 14.5528 15.4108 14.6325 14.9148C14.7123 14.463 14.6503 14.0954 14.4465 13.812C14.2428 13.5285 13.9483 13.2982 13.563 13.1211C13.1777 12.9439 12.7547 12.7889 12.2941 12.656L10.6997 12.1777C9.68991 11.8721 8.9215 11.4359 8.39447 10.869C7.87186 10.3021 7.68363 9.56023 7.82979 8.64346C7.96265 7.88169 8.28375 7.21736 8.79307 6.65046C9.30239 6.07914 9.9335 5.63625 10.6864 5.3218C11.4393 5.00292 12.2498 4.84348 13.1179 4.84348C13.9948 4.84348 14.7455 5.00292 15.37 5.3218C15.9944 5.63625 16.4595 6.07249 16.7651 6.63053C17.0706 7.18414 17.1836 7.81969 17.1039 8.53716H15.5095Z" fill="#F1D871" stroke="#000000" stroke-width="1.5" paint-order="stroke fill"/></svg>`;
      this.collapseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._toggleCollapse();
      });

      // Button group: chevron (top) + mute (bottom), stacked vertically to the right of text
      this.btnGroup = document.createElement('div');
      this.btnGroup.id = 'ss-btn-group';
      this.btnGroup.appendChild(this.ttsButton);
      this.btnGroup.appendChild(this.collapseBtn);

      this.ttsRow.appendChild(this.translationEl);
      this.ttsRow.appendChild(this.btnGroup);

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
        e.preventDefault();
        // Immediately hide — failsafe before async callback
        this.closeBtn.style.display = 'none';
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

    // ---- TTS: inline SVG icons (from icons/Mute.svg and icons/Unmute.svg) ----
    // Black stroke behind gold fill via paint-order for visibility on light backgrounds
    _ttsIcon(on) {
      const S = 'stroke="#000000" stroke-width="1.5" paint-order="stroke fill"';
      if (on) {
        // Unmuted — speaker with sound wave arcs (Mute.svg)
        return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M10.5489 18.5731C11.4748 19.4893 13.047 18.8332 13.047 17.531V6.47013C13.047 5.16624 11.4748 4.51021 10.5489 5.428L7.591 8.35642H4.88015C4.07034 8.35642 3.41431 9.01245 3.41431 9.82227V14.1771C3.41431 14.9869 4.07034 15.6429 4.88015 15.6429H7.591L10.5489 18.5731ZM11.7906 17.531C11.7906 17.7158 11.5664 17.8107 11.4339 17.6799L8.29282 14.5698C8.17503 14.452 8.01634 14.3866 7.8511 14.3866H4.88013C4.76397 14.3866 4.67072 14.2934 4.67072 14.1772V9.82238C4.67072 9.70623 4.76397 9.61297 4.88013 9.61297H7.8511L7.97216 9.60152C8.09159 9.57698 8.20448 9.51808 8.29282 9.43138L11.4339 6.32136C11.5664 6.19048 11.7906 6.28373 11.7906 6.47023L11.7906 17.531Z" fill="#F1D871" ${S}/><path d="M17.9502 18.3964C18.2431 18.5797 18.6308 18.4897 18.8156 18.1969C19.9363 16.4005 20.5858 14.2754 20.5858 11.9997C20.5858 9.72398 19.9363 7.5988 18.8156 5.80418C18.6308 5.50971 18.243 5.41973 17.9502 5.60459C17.6557 5.78782 17.5658 6.17556 17.749 6.47003C18.7502 8.07165 19.3293 9.96615 19.3293 11.9996C19.3293 14.0331 18.7502 15.9276 17.749 17.5309C17.5658 17.8237 17.6557 18.2116 17.9502 18.3964Z" fill="#F1D871" ${S}/><path d="M15.4766 15.9064C15.7842 16.0684 16.1637 15.9489 16.3257 15.643C16.9097 14.5322 17.2353 13.2986 17.2353 11.9997C17.2353 10.7007 16.9097 9.46714 16.3257 8.35796C16.1637 8.05039 15.7842 7.93098 15.4766 8.09293C15.1707 8.25489 15.0513 8.63446 15.2132 8.94199C15.7073 9.88105 15.9789 10.915 15.9789 11.9997C15.9789 13.0843 15.7073 14.1183 15.2132 15.059C15.0513 15.3649 15.1707 15.7444 15.4766 15.9064Z" fill="#F1D871" ${S}/></svg>`;
      }
      // Muted — speaker with X (Unmute.svg)
      return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M10.9681 18.5731C11.894 19.4893 13.4662 18.8332 13.4662 17.531V6.47013C13.4662 5.16624 11.894 4.51021 10.9681 5.428L8.01019 8.35642H5.29934C4.48953 8.35642 3.8335 9.01245 3.8335 9.82227V14.1771C3.8335 14.9869 4.48953 15.6429 5.29934 15.6429H8.01019L10.9681 18.5731ZM12.2098 17.531C12.2098 17.7158 11.9856 17.8107 11.8531 17.6799L8.71201 14.5698C8.59422 14.452 8.43553 14.3866 8.27029 14.3866H5.29932C5.18316 14.3866 5.08991 14.2934 5.08991 14.1772V9.82238C5.08991 9.70623 5.18316 9.61297 5.29932 9.61297H8.27029L8.39135 9.60152C8.51078 9.57698 8.62367 9.51808 8.71201 9.43138L11.8531 6.32136C11.9856 6.19048 12.2098 6.28373 12.2098 6.47023L12.2098 17.531Z" fill="#F1D871" ${S}/><path d="M19.0956 14.1197C19.3394 14.3634 19.7385 14.3634 19.9823 14.1197C20.2277 13.8743 20.2277 13.4751 19.9823 13.2313L18.752 11.9994L19.9823 10.7692C20.2277 10.5238 20.2277 10.1246 19.9823 9.88082C19.7385 9.63542 19.3393 9.63542 19.0956 9.88082L17.8637 11.1111L16.6318 9.88082C16.388 9.63542 15.9888 9.63542 15.7451 9.88082C15.4997 10.1246 15.4997 10.5238 15.7451 10.7692L16.9753 11.9994L15.7451 13.2313C15.4997 13.4751 15.4997 13.8743 15.7451 14.1197C15.9888 14.3634 16.388 14.3634 16.6318 14.1197L17.8637 12.8878L19.0956 14.1197Z" fill="#F1D871" ${S}/></svg>`;
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
        // TTS init error silenced for production
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
        }, () => void chrome.runtime.lastError);
      } catch (err) {
        void err;
      }
    }

    _stopChrome() {
      try {
        chrome.runtime.sendMessage({ type: 'tts-stop' }, () => void chrome.runtime.lastError);
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
          void e;
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
        void err;
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
          if (chrome.runtime.lastError) return;
          const s = data.ssSettings || {};
          s.ttsEnabled = this.ttsEnabled;
          chrome.storage.sync.set({ ssSettings: s }, () => void chrome.runtime.lastError);
        });
      } catch {}
    }

    _syncBg() {
      // Don't override fullscreen dark gradient set by YouTubeHandler
      if (this._inFullscreen) return;

      const bg = this._detectBg();

      if (!this.showBackground) {
        this.container.style.background = 'none';
        // No overlay background — give buttons a fill so they're visible
        this._syncBtnFill(bg);
      } else {
        const clear = this._toTransparent(bg);
        // Gradient fades over 36px, then 4px of solid background before text starts
        // (padding-top is 40px, so text begins at 40px from top)
        this.container.style.background =
          `linear-gradient(180deg, ${clear} 0px, ${bg} 36px)`;
        // Overlay provides background — buttons don't need fill or shadow
        for (const btn of [this.ttsButton, this.collapseBtn]) {
          if (!btn || (btn === this.collapseBtn && this._collapsed)) continue;
          btn.style.background = '';
          btn.style.filter = '';
        }
      }

      // Always adapt original text color to page background
      this._syncOriginalColor(bg);
    }

    // Give mute + collapse buttons the same styling as the collapsed S button
    // (semi-transparent fill + drop-shadow) when overlay background is off
    _syncBtnFill(bg) {
      if (!bg) bg = this._detectBg();
      const m = bg.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
      const lum = m ? (parseInt(m[1], 10) * 299 + parseInt(m[2], 10) * 587 + parseInt(m[3], 10) * 114) / 1000 : 0;
      const fill = lum > 128
        ? 'rgba(255, 255, 255, 0.65)'
        : 'rgba(0, 0, 0, 0.6)';
      const shadow = 'drop-shadow(0px 2px 6px rgba(0,0,0,0.4))';
      for (const btn of [this.ttsButton, this.collapseBtn]) {
        if (!btn || (btn === this.collapseBtn && this._collapsed)) continue;
        btn.style.setProperty('background', fill, 'important');
        btn.style.filter = shadow;
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

      // Reset expand state & cancel any pending expand/collapse timer
      this._expanded = false;
      if (this._expandTimer) { clearTimeout(this._expandTimer); this._expandTimer = null; }
      this._fullText = translation; // store full text for expand/collapse
      this.translationEl.classList.remove('ss-expanded');
      // Disable max-height transition so layout settles instantly for truncation measurement
      this.translationEl.style.transition = 'none';
      if (this._truncMaxHeight) this.translationEl.style.maxHeight = this._truncMaxHeight;
      this.container.classList.remove('ss-content-expanded', 'ss-expanding');

      // Clear all children, set text + see-more button
      this.translationEl.textContent = '';
      this._textNode = document.createTextNode(translation);
      this.translationEl.appendChild(this._textNode);
      if (this.seeMoreBtn) {
        this.seeMoreBtn.textContent = '\u2026 ' + this._seeMoreLabels.more;
        this.seeMoreBtn.style.display = 'none';
        this.translationEl.appendChild(this.seeMoreBtn);
      }

      this.originalEl.textContent = original;
      this.originalEl.style.display = original ? 'block' : 'none';
      this.container.classList.add('ss-visible');

      // Force layout so max-height is applied before measuring overflow
      void this.translationEl.offsetHeight;

      // Truncate text if it overflows, showing "… see more" inline
      this._truncateIfNeeded();

      // Re-enable transition for future expand/collapse animations
      requestAnimationFrame(() => {
        if (this.translationEl) this.translationEl.style.transition = '';
      });

      // Auto-speak when TTS is unmuted (always speak the full text)
      if (this.ttsEnabled && translation) {
        this._speak(translation);
      }
    }

    hide(force = false) {
      // When collapsed, keep the overlay visible so the chevron stays on screen
      // (unless force=true, e.g. extension disabled)
      if (this._collapsed && !force) return;
      if (this._collapsed) {
        this._collapsed = false;
        this._collapseAnimating = false;
        this.container?.classList.remove('ss-collapsed', 'ss-collapsing', 'ss-uncollapsing');
        if (this.collapseBtn) { this.collapseBtn.style.background = ''; this.collapseBtn.style.filter = ''; this.collapseBtn.style.transform = ''; }
      }
      this.container?.classList.remove('ss-visible');
      // Clear stale text so it doesn't flash when the overlay fades back in
      if (this.translationEl) this.translationEl.textContent = '';
      this._textNode = null;
      this._fullText = '';
      if (this.originalEl) this.originalEl.textContent = '';
    }

    // Get just the translation text (excludes "see more" button text)
    _getTranslationText() {
      return (this._fullText || '').trim();
    }

    // ---- Expand / collapse long text ----
    _toggleExpand() {
      this._expanded = !this._expanded;

      if (this._expanded) {
        // Restore full text first so we can measure the real height
        this._textNode.textContent = this._fullText;
        this.seeMoreBtn.textContent = this._seeMoreLabels.less;

        // Measure the full content height, then animate to it
        this.translationEl.style.maxHeight = 'none';
        const fullHeight = this.translationEl.scrollHeight;
        this.translationEl.style.maxHeight = this._truncMaxHeight || '';

        // Trigger reflow so the browser sees the starting value
        void this.translationEl.offsetHeight;

        // Flag the overlay to transition its own max-height smoothly
        this.container?.classList.add('ss-expanding');
        this.translationEl.classList.add('ss-expanded');
        this.translationEl.style.maxHeight = fullHeight + 'px';
        this.container?.classList.add('ss-content-expanded');

        // After transition, switch to unclamped so it adapts to resizes
        this._expandTimer = setTimeout(() => {
          this._expandTimer = null;
          this.translationEl.style.maxHeight = 'none';
          this.container?.classList.remove('ss-expanding');
        }, 380);
      } else {
        // Collapsing: animate back to truncated height
        const currentHeight = this.translationEl.scrollHeight;
        this.translationEl.style.maxHeight = currentHeight + 'px';
        void this.translationEl.offsetHeight;

        this.translationEl.classList.remove('ss-expanded');
        this.translationEl.style.maxHeight = this._truncMaxHeight || '';
        this.container?.classList.remove('ss-content-expanded');

        // After transition, re-truncate the text
        setTimeout(() => {
          this._truncateText();
        }, 380);
      }
    }

    // Truncate text if it overflows, showing "… see more" inline
    _truncateIfNeeded() {
      const checkAndTruncate = () => {
        if (!this.translationEl || !this.seeMoreBtn || !this._textNode || !this._fullText) return;
        const el = this.translationEl;
        // Always test with the FULL text — the current textNode may already be truncated
        this._textNode.textContent = this._fullText;
        this.seeMoreBtn.style.display = 'none';
        if (el.scrollHeight <= el.clientHeight + 2) {
          return; // full text fits — no truncation needed
        }
        this._truncateText();
      };
      // Run synchronously first (transition is disabled in show())
      checkAndTruncate();
      // Fallback: also check async in case layout wasn't ready
      requestAnimationFrame(() => requestAnimationFrame(checkAndTruncate));
    }

    // Binary-search truncate text so that text + "… see more" fits within max-height
    _truncateText() {
      if (!this._textNode || !this.seeMoreBtn || !this._fullText) return;
      const el = this.translationEl;
      const full = this._fullText;

      // Show the button inline so it takes up space during measurement
      this.seeMoreBtn.textContent = '\u2026 ' + this._seeMoreLabels.more;
      this.seeMoreBtn.style.display = 'inline';

      // Binary search for the longest text that fits
      let lo = 0, hi = full.length;
      while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        this._textNode.textContent = full.slice(0, mid);
        if (el.scrollHeight <= el.clientHeight + 2) {
          lo = mid;
        } else {
          hi = mid - 1;
        }
      }

      // Trim to last word boundary for cleaner cut
      let cut = lo;
      if (cut < full.length) {
        const lastSpace = full.lastIndexOf(' ', cut);
        if (lastSpace > cut * 0.5) cut = lastSpace;
      }

      this._textNode.textContent = full.slice(0, cut);
    }

    // Force-uncollapse (used when user clicks text — they want to see the subtitle)
    uncollapse() {
      if (this._collapsed) {
        const btn = this.collapseBtn;
        const startRect = btn ? btn.getBoundingClientRect() : null;

        // Disable overlay transition so layout snaps to final size for accurate measurement
        this.container.style.transition = 'none';
        this._collapsed = false;
        this._collapseAnimating = false;
        this.container.classList.remove('ss-collapsed', 'ss-collapsing');
        this.container.classList.add('ss-uncollapsing');
        // Restore button styling based on whether overlay background is on
        if (btn) { btn.style.background = ''; btn.style.filter = ''; }
        if (!this.showBackground) this._syncBtnFill();

        if (btn && startRect) {
          void this.container.offsetHeight; // force layout at final size
          const endRect = btn.getBoundingClientRect();
          const dx = startRect.left - endRect.left;
          const dy = startRect.top - endRect.top;
          btn.style.transition = 'none';
          btn.style.transform = `translate(${dx}px, ${dy}px)`;
          void btn.offsetHeight;
          this.container.style.transition = ''; // re-enable overlay transitions
          btn.style.transition = 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
          btn.style.transform = 'translate(0, 0)';
          setTimeout(() => {
            btn.style.transition = '';
            btn.style.transform = '';
            this.container.classList.remove('ss-uncollapsing');
          }, 380);
        } else {
          this.container.style.transition = ''; // re-enable
          requestAnimationFrame(() => {
            setTimeout(() => this.container.classList.remove('ss-uncollapsing'), 300);
          });
        }
      }
    }

    // ---- Collapse / expand overlay (hide subtitles when in the way) ----
    _toggleCollapse() {
      if (this._collapseAnimating) return; // prevent double-clicks during animation
      this._collapseAnimating = true;
      const btn = this.collapseBtn;

      if (!this._collapsed) {
        // ---- Collapsing: fade out content, then glide button to corner ----
        this._collapsed = true;
        this._stopSpeech();
        this.container.classList.add('ss-collapsing');

        // Capture button's current position before layout changes
        const startRect = btn ? btn.getBoundingClientRect() : null;

        // After content fades out, apply collapsed state and animate button
        setTimeout(() => {
          this.container.classList.remove('ss-collapsing');
          this.container.classList.add('ss-collapsed');
          this._syncCollapseBg();

          if (btn && startRect) {
            // Button is now position:fixed at its target — get its new position
            const endRect = btn.getBoundingClientRect();
            const dx = startRect.left - endRect.left;
            const dy = startRect.top - endRect.top;

            // Place button at its old position via transform (no transition yet)
            btn.style.transition = 'none';
            btn.style.transform = `translate(${dx}px, ${dy}px)`;
            void btn.offsetHeight; // force reflow

            // Animate to the target position
            btn.style.transition = 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
            btn.style.transform = 'translate(0, 0)';

            setTimeout(() => {
              btn.style.transition = '';
              btn.style.transform = '';
              this._collapseAnimating = false;
            }, 380);
          } else {
            this._collapseAnimating = false;
          }
        }, 250);
      } else {
        // ---- Uncollapsing: glide button back, then fade in content ----

        // Capture button's current fixed position
        const startRect = btn ? btn.getBoundingClientRect() : null;

        // Disable overlay transition so layout snaps to final state for measurement
        this.container.style.transition = 'none';
        this._collapsed = false;
        this.container.classList.remove('ss-collapsed');
        this.container.classList.add('ss-uncollapsing');
        // Restore button styling based on whether overlay background is on
        if (btn) { btn.style.background = ''; btn.style.filter = ''; }
        if (!this.showBackground) this._syncBtnFill();

        if (btn && startRect) {
          // Force layout at final size so we get the correct inline position
          void this.container.offsetHeight;
          const endRect = btn.getBoundingClientRect();
          const dx = startRect.left - endRect.left;
          const dy = startRect.top - endRect.top;

          // Place button at its old (fixed corner) position
          btn.style.transition = 'none';
          btn.style.transform = `translate(${dx}px, ${dy}px)`;
          void btn.offsetHeight;

          // Re-enable overlay transition, then animate button to inline position
          this.container.style.transition = '';
          btn.style.transition = 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
          btn.style.transform = 'translate(0, 0)';

          setTimeout(() => {
            btn.style.transition = '';
            btn.style.transform = '';
            this.container.classList.remove('ss-uncollapsing');
            this._collapseAnimating = false;
          }, 380);
        } else {
          this.container.style.transition = '';
          requestAnimationFrame(() => {
            setTimeout(() => {
              this.container.classList.remove('ss-uncollapsing');
              this._collapseAnimating = false;
            }, 300);
          });
        }
      }

      // Notify ClassicSubtitles so it can pause/resume extraction
      if (typeof this._onCollapseChange === 'function') {
        this._onCollapseChange(this._collapsed);
      }
    }

    // Set collapse button background based on page luminance (collapsed state only)
    _syncCollapseBg() {
      if (!this.collapseBtn) return;
      const bg = this._detectBg();
      const m = bg.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
      const lum = m ? (parseInt(m[1], 10) * 299 + parseInt(m[2], 10) * 587 + parseInt(m[3], 10) * 114) / 1000 : 0;
      this.collapseBtn.style.setProperty('background', lum > 128
        ? 'rgba(255, 255, 255, 0.65)'  // light site — semi-transparent white
        : 'rgba(0, 0, 0, 0.6)',        // dark site — semi-transparent black
        'important');
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
      this.closeBtn.style.display = 'flex';
    }

    hideCloseBtn() {
      if (this.closeBtn) this.closeBtn.style.display = 'none';
    }

    updateSettings(s) {
      if (!this.container) return;
      if (s.fontSize) {
        const fs = s.fontSize;
        this.translationEl.style.fontSize = fs + 'px';
        // Scale line-height so large text doesn't overlap vertically
        // Base ratio 1.21 (29/24) at default 24px, increasing to ~1.35 for 48px+
        const ratio = fs <= 24 ? 1.21 : 1.21 + (fs - 24) * 0.006;
        const lh = Math.round(fs * ratio);
        this.translationEl.style.lineHeight = lh + 'px';
        // Update max-height for 3-line truncation
        this._truncMaxHeight = (3 * lh) + 'px';
        if (!this._expanded) this.translationEl.style.maxHeight = this._truncMaxHeight;
      }
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
          const text = _getVisibleText(el);
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
          const text = _getVisibleText(descEl);
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
        // Skip if inside a link (username links)
        if (span.closest('a')) continue;
        const text = _getVisibleText(span);
        if (!text || text.length < 15) continue;
        if (!/[a-zA-Z]{2,}/.test(text)) continue;
        // Skip single-word text (likely usernames) — real captions have spaces
        if (!text.includes(' ') && text.length < 30) continue;
        if (_isNonContentText(text)) continue;
        if (_looksLikeCode(text)) continue;
        // Clean Instagram caption: strip leading reaction counts and username
        const cleaned = _cleanInstagramCaption(text);
        if (cleaned && cleaned.length >= 15) {
          return { text: cleaned.substring(0, 500), element: span };
        }
      }

      // Fallback: any caption-like text in the article (including inside <ul>)
      for (const span of spans) {
        if (span.closest('a')) continue;
        const text = _getVisibleText(span);
        if (!text || text.length < 15) continue;
        if (!/[a-zA-Z]{2,}/.test(text)) continue;
        if (!text.includes(' ') && text.length < 30) continue;
        if (_isNonContentText(text)) continue;
        if (_looksLikeCode(text)) continue;
        const cleaned = _cleanInstagramCaption(text);
        if (cleaned && cleaned.length >= 15) {
          return { text: cleaned.substring(0, 500), element: span };
        }
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
            const text = _getVisibleText(el);
            if (!text || text.length < 8 || text.length > 800) continue;
            if (!/[a-zA-Z]{2,}/.test(text)) continue;
            if (this._isExcluded(el)) continue;
            if (_isNonContentText(text)) continue;
            if (_hasConcatenatedActions(text)) continue;
            if (_looksLikeCode(text)) continue;
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
      // LinkedIn feed: post text lives in span[dir="ltr"] elements.
      // Avoid relying on specific class names — LinkedIn changes them frequently.
      // Strategy: find all span[dir="ltr"] in the main feed, score by viewport center.
      const spans = document.querySelectorAll('span[dir="ltr"]');
      let best = null, bestScore = -Infinity;
      for (const span of spans) {
        // Skip nav, header, sidebar
        if (span.closest('nav, header, aside, [role="navigation"], [role="banner"]')) continue;
        const text = _getVisibleText(span);
        if (!text || text.length < 30 || !text.includes(' ')) continue;
        if (!/[a-zA-Z]{2,}/.test(text)) continue;
        if (_isNonContentText(text) || _looksLikeCode(text)) continue;
        const rect = span.getBoundingClientRect();
        const score = this._vScore(rect);
        if (score > bestScore) { bestScore = score; best = { text: text.substring(0, 500), element: span }; }
      }
      if (best) return best;
      // Fallback: try data-urn containers or generic visible text
      return this._bestVisible(['[data-urn] span[dir="ltr"]', 'span[dir="ltr"]']);
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
              : _getVisibleText(el);
            if (!text || text.length < 8 || text.length > 800) continue;
            if (!/[a-zA-Z]{2,}/.test(text)) continue;
            if (this._isExcluded(el)) continue;
            if (_isNonContentText(text)) continue;
            if (_looksLikeCode(text)) continue;
            if (_hasConcatenatedActions(text)) continue;
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
          cls.includes('cookie') || cls.includes('consent') ||
          cls.includes('gdpr') || cls.includes('ccpa') ||
          id.includes('cookie') || id.includes('consent') ||
          id.includes('gdpr') || id.includes('ccpa')
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

        // Generic role checks — skip buttons, menus, navigation, alerts, dialogs
        const role = node.getAttribute?.('role') || '';
        if (role === 'dialog' || role === 'alert' || role === 'alertdialog' || role === 'banner' ||
            role === 'status' || role === 'log' || role === 'marquee' || role === 'timer' ||
            role === 'menu' || role === 'menuitem' ||
            role === 'menubar' || role === 'toolbar' || role === 'tablist' ||
            role === 'navigation' || role === 'complementary') return true;
        // role="button": only exclude if it's a real small button, not a large content
        // container (Instagram wraps comment <li>s in div[role="button"])
        if (role === 'button') {
          const btnText = (node.textContent?.trim() || '');
          if (btnText.length < 80) return true; // Small — real button
          // Large content container — don't exclude
        }

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
        // Detect by counting action words — only for SHORT containers (actual action bars).
        // Longer containers (e.g. Instagram post wrappers) include captions alongside buttons,
        // so we require more matches or shorter text to avoid false positives.
        if (tagName === 'section' || (tagName === 'div' && node.childElementCount > 1)) {
          const actionText = (node.textContent?.trim() || '').toLowerCase();
          const actions = ['like', 'comment', 'share', 'save', 'send', 'more',
            'me gusta', 'comentar', 'compartir', 'guardar', 'enviar', 'más',
            'reply', 'responder', 'repost', 'views', 'view all', 'ver todo'];
          const matchCount = actions.filter(a => actionText.includes(a)).length;
          // Short text (< 80): 2+ matches = action bar
          // Medium text (80-200): needs 4+ matches to be considered action bar
          if (actionText.length < 80 && matchCount >= 2) return true;
          if (actionText.length < 200 && matchCount >= 4) return true;
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
      this._ytNavTimeout = null;
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
      // Never run on login, auth, payment, or checkout pages
      if (_isRestrictedPage()) return;

      if (!this.overlay) {
        this.overlay = new SubtitleOverlay();
        this.overlay._onClose = () => this._onCloseOverlay();
        this.overlay._onCollapseChange = (collapsed) => {
          if (collapsed) {
            // Clear any active text selection, highlight, and close button
            this._clickLocked = false;
            this._hoverLocked = false;
            clearTimeout(this._hoverTimer);
            this._clearHighlight();
            this.overlay.hideCloseBtn();
            this.lastText = '';
          } else {
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
        // On YouTube non-watch pages (homepage, search), listen for SPA navigation
        // to a watch page so we can switch to YouTube mode without a refresh
        if (window.location.hostname.includes('youtube.com')) {
          this._initYTNavWatcher();
        }
      }
    }

    // Listen for YouTube SPA navigation when starting on a non-watch page
    _initYTNavWatcher() {
      if (this._ytNavHandler) return; // already listening
      this._lastYTUrl = location.href;

      this._ytNavHandler = () => this._onYTNavigate();
      document.addEventListener('yt-navigate-finish', this._ytNavHandler);

      // Fallback: URL polling
      this._ytUrlCheck = setInterval(() => {
        if (location.href !== this._lastYTUrl) {
          this._onYTNavigate();
        }
      }, 2000);
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
      // Deduplicate by URL — skip if the URL hasn't actually changed
      // (handles initial page load firing yt-navigate-finish, and double-detection
      // from both yt-navigate-finish + URL polling for the same navigation)
      if (location.href === this._lastYTUrl) return;
      this._lastYTUrl = location.href;

      // Cancel any pending navigation timeout from a previous rapid navigation
      if (this._ytNavTimeout) { clearTimeout(this._ytNavTimeout); this._ytNavTimeout = null; }

      this.ytHandler?.destroy();
      this._stopPage();
      this.overlay?._stopSpeech();
      this.overlay?.hide();
      this.overlay?.hideCloseBtn();
      this._clickLocked = false;
      this._hoverLocked = false;
      this._clearHighlight();
      this.lastText = '';

      this._ytNavTimeout = setTimeout(() => {
        this._ytNavTimeout = null;
        this.overlay?._syncBg();
        if (this._isYTWatch()) {
          this.ytHandler = new YouTubeHandler(this.overlay, this.translator, this.settings);
          this.ytHandler.init();
          this.ytHandler.handleFullscreen();
        } else {
          if (this.overlay?.container) document.body.appendChild(this.overlay.container);
          this._initPage();
        }
      }, 500);
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
      if (this._ytNavTimeout) { clearTimeout(this._ytNavTimeout); this._ytNavTimeout = null; }
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

    // Find the most specific child element near cursor with reasonable text
    _findBestChildNearPoint(el, x, y) {
      const selectors = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, a, span, yt-formatted-string, [dir="auto"]';
      const children = el.querySelectorAll(selectors);
      if (children.length === 0) return null;

      let bestChild = null, bestDist = Infinity;
      for (const child of children) {
        // Prefer the title attribute if present (e.g. YouTube #video-title)
        const titleAttr = child.getAttribute('title');
        const cText = (titleAttr && titleAttr.length >= 5) ? titleAttr.trim() : _getVisibleText(child);
        if (!cText || cText.length < 5 || cText.length > 5000) continue;
        if (!/[a-zA-Z]{2,}/.test(cText)) continue;
        if (_looksLikeCode(cText)) continue;
        if (this.extractor._isExcluded(child)) continue;
        if (this.extractor._isMostlyUsernames(cText)) continue;

        const rect = child.getBoundingClientRect();
        if (rect.height === 0 || rect.width === 0) continue;
        // Skip child elements that are off-screen (from other posts in a feed)
        if (rect.bottom < 0 || rect.top > window.innerHeight) continue;

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
      const fullText = _cleanExtractedText(_getVisibleText(el));
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

      // Universal offscreen detection: if the source element for the current
      // subtitle has scrolled out of the viewport, clear it immediately.
      // Works for ALL states (click-locked, hover-locked, auto) on ALL sites.
      if (this._lastSourceEl && this.lastText) {
        const r = this._lastSourceEl.getBoundingClientRect();
        if (r.bottom < -50 || r.top > window.innerHeight + 50) {
          this._clickLocked = false;
          this._hoverLocked = false;
          this.overlay?.hide();
          this.overlay?.hideCloseBtn();
          this._clearHighlight();
          this.lastText = '';
          // Don't return — fall through to _showBest to find new text
        }
      }

      // If click-locked (and source still visible), don't auto-extract
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
      // Instagram: extract caption or comment text precisely (avoid reaction counts / usernames)
      if (window.location.hostname.includes('instagram.com')) {
        // Comments: inside a list item
        const li = el.closest?.('li');
        if (li) {
          const spans = li.querySelectorAll('span[dir="auto"]');
          for (const span of spans) {
            if (span.closest('a')) continue; // Username link
            const t = _getVisibleText(span);
            if (!t || t.length < 8 || !/[a-zA-Z]{2,}/.test(t)) continue;
            if (_isNonContentText(t)) continue;
            if (!t.includes(' ') && t.length < 25) continue;
            const cleaned = _cleanExtractedText(t);
            if (cleaned && cleaned.length >= 8) {
              return { targetEl: span, cleaned: cleaned.substring(0, 1500) };
            }
          }
        }
        // Feed posts: inside an article — extract ONLY the caption span
        const article = el.closest?.('article');
        if (article) {
          const spans = article.querySelectorAll('span[dir="auto"]');
          for (const span of spans) {
            if (span.closest('ul')) continue;  // Comment list
            if (span.closest('a')) continue;   // Username link
            const rect = span.getBoundingClientRect();
            // Only consider spans near the cursor vertically
            if (y < rect.top - 40 || y > rect.bottom + 40) continue;
            const t = _getVisibleText(span);
            if (!t || t.length < 15 || !/[a-zA-Z]{2,}/.test(t)) continue;
            if (!t.includes(' ') && t.length < 30) continue; // Single word = username
            if (_isNonContentText(t)) continue;
            const cleaned = _cleanInstagramCaption(_cleanExtractedText(t));
            if (cleaned && cleaned.length >= 15) {
              return { targetEl: span, cleaned: cleaned.substring(0, 1500) };
            }
          }
          return null; // Inside article but no caption found — don't fall through to generic
        }
      }

      // LinkedIn: walk up from hover target to find the post text container.
      // LinkedIn changes class names frequently, so use robust detection:
      // post text is always inside span[dir="ltr"] with substantial multi-word content.
      if (window.location.hostname.includes('linkedin.com')) {
        let node = el;
        for (let d = 0; node && node !== document.body && d < 12; d++) {
          // Check if this node (or a dir="ltr" span inside it) has substantial post text
          const candidate = (node.getAttribute?.('dir') === 'ltr' && node.tagName?.toLowerCase() === 'span')
            ? node
            : node.querySelector?.('span[dir="ltr"]');
          if (candidate) {
            const t = _getVisibleText(candidate);
            // Must have real multi-word content (not just a name or button label)
            if (t && t.length >= 30 && t.includes(' ') && /[a-zA-Z]{2,}/.test(t) && !_looksLikeCode(t)) {
              const cleaned = _cleanExtractedText(t);
              if (cleaned && cleaned.length >= 20) {
                return { targetEl: candidate, cleaned: cleaned.substring(0, 1500) };
              }
            }
          }
          node = node.parentElement;
        }
      }

      // Reddit: if inside a shreddit-comment, extract that specific comment's content
      // Return full text (up to 1500 chars) — visual truncation handled by "see more" UI
      const rc = el.closest?.('shreddit-comment');
      if (rc) {
        // :scope > ensures we get THIS comment's content, not a nested reply's
        const ce = rc.querySelector(':scope > [slot="comment"] .md') ||
                   rc.querySelector(':scope > [slot="comment"]') ||
                   rc.querySelector(':scope > .md');
        if (ce) {
          const t = _getVisibleText(ce);
          if (t && t.length >= 5 && /[a-zA-Z]{2,}/.test(t) && !_looksLikeCode(t)) {
            let cleaned = _cleanExtractedText(t);
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
            const t = _getVisibleText(bodyEl);
            if (t && t.length >= 5 && /[a-zA-Z]{2,}/.test(t) && !_looksLikeCode(t)) {
              let cleaned = _cleanExtractedText(t);
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
          return { targetEl: titleEl || rp, cleaned: _cleanExtractedText(postTitle) };
        }
      }

      // Reject oversized containers: if the element extends well beyond the viewport,
      // it's a page/feed container (not specific content). Only translate text from
      // elements that are roughly viewport-sized or smaller.
      {
        const elRect = el.getBoundingClientRect();
        const vh = window.innerHeight;
        if (elRect.height > vh * 2) return null; // Element is > 2× viewport — too large
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
        const linkText = _getVisibleText(el);
        if (linkText && linkText.length >= 2 && /[a-zA-Z]{2,}/.test(linkText) && !_looksLikeCode(linkText)) {
          const cleaned = _cleanExtractedText(linkText);
          if (cleaned && cleaned.length >= 2 && cleaned.length <= 300 && !_hasConcatenatedActions(cleaned)) {
            return { targetEl: el, cleaned };
          }
        }
      }

      // Check title attribute (YouTube #video-title uses title attr for clean text)
      const titleAttr = el.getAttribute?.('title');
      if (titleAttr && titleAttr.length >= 5 && titleAttr.length <= 300 && /[a-zA-Z]{2,}/.test(titleAttr)) {
        return { targetEl: el, cleaned: _cleanExtractedText(titleAttr) };
      }

      const rawText = _getVisibleText(el);
      if (!rawText || rawText.length < 5 || !/[a-zA-Z]{2,}/.test(rawText)) return null;
      // Reject code/metadata (script content from web components)
      if (_looksLikeCode(rawText)) return null;
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

      if (rawText.length <= 1500 && !_hasConcatenatedActions(rawText)) {
        // Moderate text without concatenated UI — use as-is after cleaning
        cleaned = _cleanExtractedText(rawText);
      } else {
        // Very long text or concatenated action text — drill down to find specific child
        const child = this._findBestChildNearPoint(el, x, y);
        if (child) {
          targetEl = child.el;
          cleaned = _cleanExtractedText(child.text);
        } else {
          // No specific child — extract nearby sentences
          cleaned = this._extractNearbySentences(el, x, y);
        }
      }

      if (!cleaned || cleaned.length < 5 || _looksLikeCode(cleaned)) return null;
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
        // Close button click — actively dismiss lock (capture fires before btn handler)
        if (el.id === 'ss-close-btn') {
          this._onCloseOverlay();
          return;
        }
        // Skip our own overlay elements
        if (el.id === 'ss-overlay' || el.id === 'ss-translation' || el.id === 'ss-original' ||
            el.id === 'ss-tts-btn' || el.id === 'ss-tts-row' ||
            el.id === 'ss-see-more-btn' ||
            el.id === 'ss-collapse-btn') return;

        const result = this._smartExtract(el, e.clientX, e.clientY);
        if (result) {
          // Never show subtitles when clicking buttons, tabs, or navigational components
          const interactive = this._isInteractiveEl(e.target, result.targetEl);
          if (interactive) return;

          // Only lock and show (x) for long static text (paragraphs, descriptions).
          if (result.cleaned.length >= 40) {
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

      // Debounce rapid mouseover events — short delay to batch rapid
      // mouse movements while still feeling responsive
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
      }, 50);
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

      // If the source element for the current subtitle has scrolled offscreen,
      // hide the stale subtitle and reset so a new one will be found
      if (this._lastSourceEl && this.lastText) {
        const r = this._lastSourceEl.getBoundingClientRect();
        if (r.bottom < -50 || r.top > window.innerHeight + 50) {
          this.overlay?.hide();
          this._clearHighlight();
          this.lastText = '';
        }
      }

      const result = this.extractor.extractSingle();
      if (!result || result.text === this.lastText) return;
      // Universal safety net: reject concatenated UI text from any extractor
      if (_hasConcatenatedActions(result.text) ||
          _isNonContentText(result.text)) return;
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
      this._lastSourceEl = el || null; // Track source for offscreen detection
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
          this.overlay?.hide(true);
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

        // Language changed → clear translation cache and re-translate current text
        if (oldLang !== this.settings.targetLang) {
          this.translator.cache.clear();
          this.translator.pending.clear();
          ++this._translateGen; // Cancel any in-flight old-language translations

          if (this._isYTWatch()) {
            this.ytHandler?.destroy();
            this.ytHandler = new YouTubeHandler(this.overlay, this.translator, this.settings);
            this.ytHandler.init();
            this.ytHandler.handleFullscreen();
          } else {
            // Re-translate whatever text is currently shown (don't hide the overlay)
            const currentSource = (this._clickLocked && this._lastSourceEl)
              ? this._lastSourceEl.textContent?.trim()
              : this.lastText;
            if (currentSource) {
              this.lastText = currentSource;
              this._translateText(currentSource);
            }
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
