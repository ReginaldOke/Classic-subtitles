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
      this.showBackground = false;
      this.ttsEnabled = false;
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

      this.ttsButton = document.createElement('button');
      this.ttsButton.id = 'ss-tts-btn';
      this.ttsButton.innerHTML = this._ttsIcon(false);
      this.ttsButton.addEventListener('click', (e) => {
        e.stopPropagation();
        this._toggleTTS();
      });

      this.ttsRow.appendChild(this.translationEl);
      this.ttsRow.appendChild(this.ttsButton);

      this.originalEl = document.createElement('div');
      this.originalEl.id = 'ss-original';

      this.container.appendChild(this.ttsRow);
      this.container.appendChild(this.originalEl);
      document.body.appendChild(this.container);
    }

    // ---- TTS: inline SVG icons ----
    _ttsIcon(on) {
      if (on) {
        // Speaker with sound waves (unmuted)
        return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
          <path d="M15.54 8.46a5 5 0 010 7.07" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M19.07 4.93a10 10 0 010 14.14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>`;
      }
      // Speaker with X (muted)
      return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
        <line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>`;
    }

    // ---- TTS: initialise voices ----
    _initTTS() {
      try {
        const loadVoices = () => {
          this._ttsVoices = window.speechSynthesis.getVoices();
          this._pickVoice();
        };
        loadVoices();
        if (this._ttsVoices.length === 0) {
          window.speechSynthesis.addEventListener('voiceschanged', loadVoices, { once: true });
        }
      } catch {}
    }

    _pickVoice() {
      const lang = this._ttsLang || 'es';
      const v = this._ttsVoices;
      // Exact match (e.g. es-ES), then prefix (es-*), then any
      this._ttsVoice =
        v.find(x => x.lang === lang + '-ES') ||
        v.find(x => x.lang === lang + '-MX') ||
        v.find(x => x.lang.startsWith(lang + '-')) ||
        v.find(x => x.lang.startsWith(lang)) ||
        null;
    }

    _updateTTSVoice(lang) {
      this._ttsLang = lang || 'es';
      this._pickVoice();
    }

    // ---- TTS: speak / stop ----
    _speak(text) {
      if (!text?.trim()) return;
      try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        if (this._ttsVoice) utter.voice = this._ttsVoice;
        utter.lang = this._ttsLang || 'es';
        utter.rate = 0.9;
        utter.pitch = 1.0;
        utter.volume = 1.0;
        window.speechSynthesis.speak(utter);
      } catch {}
    }

    _stopSpeech() {
      try { window.speechSynthesis.cancel(); } catch {}
    }

    // ---- TTS: toggle mute/unmute ----
    _toggleTTS() {
      this.ttsEnabled = !this.ttsEnabled;
      this.ttsButton.innerHTML = this._ttsIcon(this.ttsEnabled);

      if (this.ttsEnabled) {
        // Speak current text immediately
        const text = this.translationEl?.textContent;
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
        this.container.style.background =
          `linear-gradient(180deg, ${clear} 0%, ${bg} 50%)`;
      }

      // Always adapt original text color to page background
      this._syncOriginalColor(bg);
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
      const obs = new MutationObserver(() => {
        setTimeout(() => this._syncBg(), 200);
      });
      const attrs = ['class', 'style', 'data-theme', 'data-color-mode', 'data-dark-theme'];
      for (const el of [document.documentElement, document.body]) {
        if (el) obs.observe(el, { attributes: true, attributeFilter: attrs });
      }
      setInterval(() => this._syncBg(), 8000);
    }

    show(translation, original = '') {
      if (!this.container) return;
      this.translationEl.textContent = translation;
      this.originalEl.textContent = original;
      this.originalEl.style.display = original ? 'block' : 'none';
      this.container.classList.add('ss-visible');

      // Auto-speak when TTS is unmuted
      if (this.ttsEnabled && translation) {
        this._speak(translation);
      }
    }

    hide() {
      this.container?.classList.remove('ss-visible');
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
      this.container?.remove();
      this.container = null;
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
      const cleaned = text.trim().substring(0, 500);
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
      // Use the 'title' attribute on #video-title elements — it contains only the
      // clean title text, unlike textContent which can include player overlay controls
      // (Tap to unmute, 2x, Search, Share, etc.) from video preview hover.
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

    // Comment pages — translate only the comment BODY closest to center
    _redditComment() {
      // Shreddit (new Reddit) — find comment body text within shreddit-comment elements
      const comments = document.querySelectorAll('shreddit-comment');
      if (comments.length > 0) {
        let best = null, bestScore = -Infinity, bestEl = null;
        for (const comment of comments) {
          // Find the actual comment text in known content containers
          const contentEl =
            comment.querySelector('[slot="comment"] .md') ||
            comment.querySelector('[slot="comment"]') ||
            comment.querySelector('.md') ||
            comment.querySelector('p');
          if (!contentEl) continue;
          const text = contentEl.textContent?.trim();
          if (!text || text.length < 8 || text.length > 500) continue;
          if (!/[a-zA-Z]{2,}/.test(text)) continue;
          const rect = comment.getBoundingClientRect();
          const score = this._vScore(rect);
          if (score > bestScore) {
            bestScore = score;
            best = text.substring(0, 300);
            bestEl = comment;
          }
        }
        if (best) return { text: best, element: bestEl };
      }
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
        // Story text overlays are positioned absolute on the story media
        // These are user-added captions, questions, polls etc.
        return this._bestVisible([
          '[class*="StoryText"] span',                         // Story text sticker
          '[style*="position: absolute"] span[dir="auto"]',    // Positioned text overlay
        ]);
      }

      // Post detail pages — individual comments/captions
      const isPost = path.startsWith('/p/') ||
                     path.startsWith('/reel/') ||
                     document.querySelector('[role="dialog"] article');

      if (isPost) {
        const comment = this._bestVisible([
          'ul li[role="menuitem"] span[dir="auto"]',
          'ul > div > li span[dir="auto"]',
          'ul > li span[dir="auto"]',
        ]);
        if (comment) return comment;
      }

      // Profile pages — individual text elements (name, bio), not the whole header
      if (/^\/[^/]+\/?$/.test(path) && !path.startsWith('/p/')) {
        return this._bestVisible([
          'header section span[dir="auto"]',   // Bio text
          'header h2',                          // Display name
        ]);
      }

      // Feed page or fallback: post captions
      return this._bestVisible(['h1', 'article span[dir="auto"]', 'span._ap3a']);
    }

    _facebook() { return this._bestVisible(['[data-ad-preview="message"]', '[dir="auto"]']); }
    _tiktok() { return this._bestVisible(['[data-e2e="browse-video-desc"]']); }
    _hn() { return this._bestVisible(['.titleline > a', '.title > a']); }
    _linkedin() { return this._bestVisible(['.feed-shared-update-v2__description', '.break-words span[dir="ltr"]']); }

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
            const text = (preferAttr && el.getAttribute(preferAttr))
              ? el.getAttribute(preferAttr).trim()
              : el.textContent?.trim();
            if (!text || text.length < 8 || text.length > 400) continue;
            if (!/[a-zA-Z]{2,}/.test(text)) continue;
            if (this._isExcluded(el)) continue;
            const rect = el.getBoundingClientRect();
            const score = this._vScore(rect);
            if (score > bestScore) {
              bestScore = score;
              best = text.substring(0, 300);
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
          testId.includes('flair') || testId.includes('author') ||
          testId.includes('subreddit-name')
        ) return true;

        // Generic role checks — skip buttons, menus, dialogs, navigation
        const role = node.getAttribute?.('role') || '';
        if (role === 'dialog' || role === 'alertdialog' || role === 'banner' ||
            role === 'button' || role === 'menu' || role === 'menuitem' ||
            role === 'menubar' || role === 'toolbar' || role === 'tablist') return true;

        // Skip <button> elements and their children (never translate buttons/actions)
        if (tag === 'button') return true;

        // Instagram-specific: story UI, reactions, username headers, action bars
        if (
          cls.includes('_ac') && cls.includes('story') || // story overlay elements
          cls.includes('coreSpriteMore') || cls.includes('coreSprite') ||
          cls.includes('_a9-') || // IG action bar classes
          tagName === 'time' // timestamps
        ) return true;

        node = node.parentElement;
      }
      return false;
    }

    // Check if text is mostly usernames/handles (should not be translated)
    _isMostlyUsernames(text) {
      if (!text) return false;
      // Text that is primarily @mentions or handle-like patterns
      const words = text.split(/\s+/);
      const handleWords = words.filter(w => /^@?\w[\w.]+$/.test(w) && w.length > 2);
      return handleWords.length > 0 && handleWords.length >= words.length * 0.5;
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
      this._captionSource = null; // 'intercepted'|'tracks'|'dom'
      this._pendingTracks = null;

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

      // Listen for pause/play to toggle between captions and page-browse mode
      this._initPausePlayListeners();
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
        // Security: only allow YouTube timedtext API URLs
        if (!url.hostname.endsWith('youtube.com') && !url.hostname.endsWith('googlevideo.com')) return;
        if (!url.pathname.includes('/api/timedtext')) return;
        const lang = this.settings.targetLang || 'es';

        // Try with our target language (YouTube's own tlang translation)
        url.searchParams.set('tlang', lang);
        url.searchParams.set('fmt', 'json3');

        let resp = await fetch(url.toString());
        if (resp.ok) {
          const data = await resp.json();
          if (this._loadCaptions(data, false)) {
            this._captionSource = 'intercepted';
            return;
          }
        }

        // tlang rejected — fetch original and translate ourselves
        url.searchParams.delete('tlang');
        resp = await fetch(url.toString());
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

      const lang = this.settings.targetLang || 'es';
      const sep = track.baseUrl.includes('?') ? '&' : '?';

      // Try YouTube's own translation via tlang
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
          }
        }
      } catch {}

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
      this.captionTrack = track;
      this._startSync(needsTranslation);
      return true;
    }

    _startSync(needsTranslation) {
      if (this.syncInterval) clearInterval(this.syncInterval);
      if (!this.captionTrack || !this.video) return;
      let lastIdx = -1;
      this.syncInterval = setInterval(async () => {
        if (!this.active) return;
        if (this._paused) return; // Pause mode handles overlay
        const t = this.video.currentTime;
        const idx = this._findCaption(t, lastIdx);
        if (idx !== -1 && idx !== lastIdx) {
          lastIdx = idx;
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
        // Don't override intercepted captions with DOM captions
        if (this._captionSource === 'intercepted') return;
        if (this._paused) return; // Pause mode handles overlay

        const segs = document.querySelectorAll('.ytp-caption-segment');
        if (segs.length) {
          const text = Array.from(segs).map(s => s.textContent).join(' ').trim();
          if (text && text !== this.lastCapText) {
            this.lastCapText = text;
            this._translateAndShow(text);
          }
        }
      });
      const target = document.querySelector('#movie_player') || document.body;
      this.captionObserver.observe(target, {
        childList: true, subtree: true, characterData: true,
      });
    }

    async _translateAndShow(text) {
      const tr = await this.translator.translate(text, this.settings.targetLang || 'es');
      if (tr && this.active) this.overlay.show(tr, this.settings.showOriginal ? text : '');
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

      // Start scroll/click/observer for comments
      this._startPauseScroll();
      this._startPauseClick();
      this._startPauseCommentObserver();
    }

    _exitPauseMode() {
      if (!this._paused) return;
      this._paused = false;
      this._pauseClickLocked = false;
      this._pauseLastText = '';

      this._stopPauseScroll();
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
          // Always use dark gradient in fullscreen (video content is always dark)
          this.overlay.container.style.background =
            'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.85) 50%)';
          // Mark fullscreen so _syncBg() won't override our dark gradient
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
      this._captionSource = null;
      this.captionTrack = null;
      this._pendingTracks = null;
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
    }

    async start() {
      await this._loadSettings();
      if (!this.settings.enabled) return;

      this.overlay = new SubtitleOverlay();
      this.translator = new TranslationService();
      this.extractor = new TextExtractor();
      this.overlay.updateSettings(this.settings);

      if (this._isYTWatch()) {
        this._initYouTube();
      } else {
        this._initPage();
      }

      this._listenSettings();
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
      this.domObserver = new MutationObserver(() => {
        clearTimeout(this._domTimer);
        this._domTimer = setTimeout(() => this._showBest(), 300);
      });
      this.domObserver.observe(document.body, { childList: true, subtree: true });
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

    _onScroll() {
      // Scrolling releases click and hover locks — auto-extraction resumes
      this._clickLocked = false;
      this._hoverLocked = false;

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

    // ---- Click to translate (highest priority — overrides hover and auto) ----
    _onClick(e) {
      if (this._isYTWatch()) return;

      // Click always overrides hover
      this._hoverLocked = false;
      clearTimeout(this._hoverTimer);

      // Walk up from click target to find meaningful text
      let el = e.target;
      while (el && el !== document.body) {
        // Skip our own overlay
        if (el.id === 'ss-overlay' || el.id === 'ss-translation' || el.id === 'ss-original' ||
            el.id === 'ss-tts-btn' || el.id === 'ss-tts-row') return;

        const text = el.textContent?.trim();
        if (text && text.length >= 5 && text.length <= 800 && /[a-zA-Z]{2,}/.test(text)) {
          // Skip excluded elements, usernames, buttons
          if (this.extractor._isExcluded(el) || this.extractor._isMostlyUsernames(text)) {
            el = el.parentElement;
            continue;
          }
          const cleaned = text.substring(0, 300);
          if (cleaned === this.lastText) return; // already showing this
          this.lastText = cleaned;
          this._clickLocked = true; // Lock — prevent auto-extraction from overriding
          this._highlightElement(el);
          this._translateText(cleaned);
          return;
        }
        el = el.parentElement;
      }

      // Clicked on non-text area — unlock so auto-extraction resumes
      this._clickLocked = false;
      this.lastText = '';
      this._showBest();
    }

    // ---- Hover to translate — works on any page, overrides click lock ----
    _onHover(e) {
      if (this._isYTWatch()) return;

      // Debounce rapid mouseover events
      clearTimeout(this._hoverTimer);
      this._hoverTimer = setTimeout(() => {
        // Walk up from hover target to find meaningful text
        let el = e.target;
        let depth = 0;
        while (el && el !== document.body && depth < 6) {
          // Skip our own overlay
          if (el.id === 'ss-overlay' || el.id === 'ss-translation' || el.id === 'ss-original' ||
              el.id === 'ss-tts-btn' || el.id === 'ss-tts-row') return;

          const text = el.textContent?.trim();
          if (text && text.length >= 5 && text.length <= 500 && /[a-zA-Z]{2,}/.test(text)) {
            // Skip excluded elements, usernames, buttons
            if (this.extractor._isExcluded(el) || this.extractor._isMostlyUsernames(text)) {
              el = el.parentElement;
              depth++;
              continue;
            }
            const cleaned = text.substring(0, 300);
            if (cleaned === this.lastText) return; // already showing this
            this.lastText = cleaned;
            this._clickLocked = false; // Hover overrides click lock
            this._hoverLocked = true;
            this._highlightElement(el);
            this._translateText(cleaned);
            return;
          }
          el = el.parentElement;
          depth++;
        }
      }, 120); // 120ms debounce — fast enough to feel instant, slow enough to skip fly-overs
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
      const result = this.extractor.extractSingle();
      if (!result || result.text === this.lastText) return;
      this.lastText = result.text;

      this._highlightElement(result.element);
      this._translateText(result.text);
    }

    async _translateText(text) {
      const tr = await this.translator.translate(text, this.settings.targetLang);
      if (tr) {
        this.overlay.show(tr, this.settings.showOriginal ? text : '');
      }
    }

    // ---- Highlight source element ----
    _highlightElement(el) {
      this._clearHighlight();
      if (this.settings.highlightMode && el) {
        el.classList.add('ss-highlighted');
        this._highlightedEl = el;
      }
    }

    _clearHighlight() {
      if (this._highlightedEl) {
        this._highlightedEl.classList.remove('ss-highlighted');
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
          this._clearHighlight();
          this._stopYouTube();
          this._stopPage();
          return;
        }

        // Turned on from off
        if (!wasOn) {
          if (this._isYTWatch()) this._initYouTube();
          else this._initPage();
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
