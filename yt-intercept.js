// ============================================
// CLASSIC SUBTITLES — YouTube Fetch Interceptor
// Runs in MAIN world to:
//   1. Monkey-patch fetch to capture /api/timedtext URLs
//   2. Intercept /youtubei/v1/player responses for caption tracks
//   3. Trigger caption loading via YouTube's player API
//   4. Hide YouTube's built-in caption display
// ============================================
(function () {
  'use strict';
  if (window.__csTimedtextInterceptor) return;
  window.__csTimedtextInterceptor = true;

  const _fetch = window.fetch;
  let _captionsTriggered = false;

  // Store intercepted data so it can be re-sent when content script is ready
  // (the player response often arrives before content.js sets up its listener)
  let _lastTimedtextUrl = null;
  let _lastCaptionTracks = null;

  // ---- Immediately hide YouTube's native captions ----
  // Inject CSS as early as possible so captions never flash on screen.
  // Our extension replaces them with styled yellow subtitles.
  _hideYTCaptions();

  // ---- Monkey-patch fetch ----
  window.fetch = function (...args) {
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      // Capture timedtext URLs — these have valid, fresh POT tokens
      if (url.includes('/api/timedtext') && url.includes('v=')) {
        _lastTimedtextUrl = url;
        window.postMessage({ type: '__CS_TIMEDTEXT_URL__', url }, window.location.origin);
      }
    } catch {}

    const result = _fetch.apply(this, args);

    // Intercept /youtubei/v1/player responses — always contains caption tracks
    // This works even when CC is disabled because YouTube fetches player data for every video
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (url.includes('/youtubei/v1/player')) {
        result
          .then(resp => resp.clone().json().then(_onPlayerResponse).catch(() => {}))
          .catch(() => {});
      }
    } catch {}

    return result;
  };

  // ---- Extract caption tracks from player API response ----
  function _onPlayerResponse(data) {
    try {
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (!tracks || tracks.length === 0) return;
      const mapped = tracks.map(t => ({
        baseUrl: t.baseUrl,
        languageCode: t.languageCode,
        kind: t.kind || '',
        name: t.name?.simpleText || t.name?.runs?.[0]?.text || '',
      }));
      _lastCaptionTracks = mapped;
      window.postMessage({
        type: '__CS_CAPTION_TRACKS__',
        tracks: mapped,
      }, window.location.origin);
    } catch {}
  }

  // ---- Trigger caption loading via YouTube's player API ----
  function triggerCaptionLoad() {
    try {
      const player = document.getElementById('movie_player');
      if (!player || typeof player.loadModule !== 'function') return false;

      // Load the captions module
      player.loadModule('captions');

      // Try to toggle subtitles on (works even before tracklist is populated)
      if (typeof player.isSubtitlesOn === 'function' && !player.isSubtitlesOn()) {
        if (typeof player.toggleSubtitlesOn === 'function') {
          player.toggleSubtitlesOn();
        }
      }

      // Get available tracks
      const tracklist = player.getOption('captions', 'tracklist');
      if (!tracklist?.length) return false;

      // Pick the best track: prefer English manual, then any manual, then any
      const enManual = tracklist.find(t => t.languageCode === 'en' && t.kind !== 'asr');
      const anyManual = tracklist.find(t => t.kind !== 'asr');
      const track = enManual || anyManual || tracklist[0];

      // Enable the track — triggers YouTube to fetch from /api/timedtext
      player.setOption('captions', 'track', track);

      // Hide YouTube's built-in caption display (our overlay replaces it)
      _hideYTCaptions();

      _captionsTriggered = true;
      return true;
    } catch { return false; }
  }

  // ---- Hide YouTube's native caption rendering ----
  function _hideYTCaptions() {
    if (document.getElementById('__cs_hide_yt_captions')) return;
    const style = document.createElement('style');
    style.id = '__cs_hide_yt_captions';
    // Use opacity: 0 so DOM elements still exist for fallback observation.
    // Target all known caption containers for robustness.
    style.textContent = `
      .caption-window,
      .ytp-caption-window-container,
      .ytp-caption-window-bottom,
      .ytp-caption-window-top,
      .captions-text {
        opacity: 0 !important;
        pointer-events: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  // ---- Poll until YouTube's player is ready ----
  function waitAndTrigger(attempts) {
    if (attempts > 60) return; // Give up after ~30s
    if (triggerCaptionLoad()) return; // Success
    setTimeout(() => waitAndTrigger(attempts + 1), 500);
  }

  // ---- Listen for requests from content script ----
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type === '__CS_REQUEST_CAPTIONS__') {
      // Re-send any previously intercepted data (handles race condition where
      // player response arrived before content script was ready)
      if (_lastTimedtextUrl) {
        window.postMessage({ type: '__CS_TIMEDTEXT_URL__', url: _lastTimedtextUrl }, window.location.origin);
      }
      if (_lastCaptionTracks) {
        window.postMessage({ type: '__CS_CAPTION_TRACKS__', tracks: _lastCaptionTracks }, window.location.origin);
      }
      // Always try player API approach — don't skip even if previously triggered,
      // because after ads end or SPA navigation we need to re-trigger caption loading
      _captionsTriggered = false;
      waitAndTrigger(0);
    }
  });

  // ---- Extract captions from ytInitialPlayerResponse (available before any fetch) ----
  function tryInitialPlayerResponse() {
    try {
      const data = window.ytInitialPlayerResponse;
      if (data) _onPlayerResponse(data);
    } catch {}
  }

  // ---- Intercept XHR for timedtext URLs (fallback for XMLHttpRequest usage) ----
  try {
    const _xhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      try {
        const u = typeof url === 'string' ? url : '';
        if (u.includes('/api/timedtext') && u.includes('v=')) {
          _lastTimedtextUrl = u;
          window.postMessage({ type: '__CS_TIMEDTEXT_URL__', url: u }, window.location.origin);
        }
      } catch {}
      return _xhrOpen.call(this, method, url, ...rest);
    };
  } catch {}

  // ---- Start polling after page loads ----
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    tryInitialPlayerResponse();
    setTimeout(() => waitAndTrigger(0), 1000);
  } else {
    window.addEventListener('DOMContentLoaded', () => {
      tryInitialPlayerResponse();
      setTimeout(() => waitAndTrigger(0), 1000);
    });
  }

  // ---- Re-trigger on YouTube SPA navigation ----
  document.addEventListener('yt-navigate-finish', () => {
    _captionsTriggered = false;
    _lastTimedtextUrl = null;
    // Don't reset _lastCaptionTracks immediately — the player response for the
    // new video may have already arrived. Clear after a delay only if new tracks came.
    const oldTracks = _lastCaptionTracks;
    setTimeout(() => {
      // If tracks haven't been updated by a new player response, clear stale ones
      if (_lastCaptionTracks === oldTracks) _lastCaptionTracks = null;
    }, 5000);
    // Ensure caption-hiding CSS persists across navigation
    _hideYTCaptions();
    // Wait for new video's player to be ready — try sooner and keep retrying
    setTimeout(() => waitAndTrigger(0), 500);
    setTimeout(() => waitAndTrigger(0), 2000);
  });
})();
