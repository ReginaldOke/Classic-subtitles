// ============================================
// CLASSIC SUBTITLES - Background Service Worker
// Translation API, caching, settings management
// ============================================

const TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single';
const CACHE_MAX_SIZE = 2000;
const STORAGE_CACHE_MAX = 1500; // Persistent cache eviction threshold
const VALID_LANGS = new Set([
  'en','es','fr','de','it','pt','ja','ko','zh','ar','hi','ru',
  'nl','el','pl','th','tr',
  'vi','id','sv','da','no','fi','cs','ro','uk','hu',
]);
const BATCH_CONCURRENCY = 5;

const translationCache = new Map();
const iconCache = {}; // Cache rendered icon ImageData: { enabled: {}, disabled: {} }

// ---- Default Settings ----
const DEFAULT_SETTINGS = {
  enabled: true,
  fontSize: 24,
  showOriginal: false,
  showBackground: true,
  highlightMode: false,
  targetLang: 'es',
  ttsEnabled: false,
};

// ---- Message Handler ----
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'translate':
      handleTranslation(message.text, message.target || 'es')
        .then(translation => sendResponse({ translation }))
        .catch(err => {
          sendResponse({ translation: null, error: err.message });
        });
      return true; // Keep channel open for async response

    case 'getSettings':
      chrome.storage.sync.get('ssSettings', (data) => {
        if (chrome.runtime.lastError) {
          sendResponse(DEFAULT_SETTINGS);
          return;
        }
        sendResponse(data.ssSettings || DEFAULT_SETTINGS);
      });
      return true;

    case 'saveSettings':
      chrome.storage.sync.set({ ssSettings: message.settings }, () => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse({ success: true });
      });
      return true;

    case 'translateBatch':
      handleBatchTranslation(message.texts, message.target || 'es')
        .then(translations => sendResponse({ translations }))
        .catch(err => sendResponse({ translations: [], error: err.message }));
      return true;

    case 'tts-speak':
      try {
        chrome.tts.stop();
        const lang = message.lang || 'es';
        // Find a female voice for the target language
        chrome.tts.getVoices((voices) => {
          const opts = {
            lang: lang,
            rate: message.rate || 0.9,
            volume: 1.0,
            enqueue: false,
          };
          if (voices && voices.length) {
            const matches = voices.filter(v => v.lang && v.lang.startsWith(lang));
            // Prefer female-sounding voice names
            const femaleRx = /\b(female|helena|sabina|paulina|monica|lucia|elvira|conchita|penelope|lupe|mia|ines|francisca|carmen|zira|hazel|susan|samantha|fiona|google)\b/i;
            const maleRx = /\b(male|jorge|pablo|andres|enrique|diego|carlos|david|daniel|james|mark|richard)\b/i;
            // First try: explicit female name match
            let pick = matches.find(v => femaleRx.test(v.voiceName));
            // Second try: any match that isn't explicitly male
            if (!pick && matches.length) pick = matches.find(v => !maleRx.test(v.voiceName)) || matches[0];
            if (pick) opts.voiceName = pick.voiceName;
          }
          chrome.tts.speak(message.text, opts, () => {
            void chrome.runtime.lastError;
          });
        });
      } catch (err) {
        void err;
      }
      return false;

    case 'tts-stop':
      try { chrome.tts.stop(); } catch {}
      return false;

    case 'updateIcon':
      updateIcon(message.enabled);
      return false;
  }
});

// ---- Translation ----
async function handleTranslation(text, targetLang) {
  if (!text?.trim()) return null;

  // Validate language code
  const lang = VALID_LANGS.has(targetLang) ? targetLang : 'es';

  const trimmed = text.trim().substring(0, 1500); // Cap length (supports full paragraphs)
  const cacheKey = `t|${trimmed}|${lang}`; // Prefix 't|' to namespace translation cache keys

  // Check in-memory cache
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  // Check persistent cache
  const stored = await getStoredTranslation(cacheKey);
  if (stored) {
    translationCache.set(cacheKey, stored);
    return stored;
  }

  // Call translation API
  const translation = await callTranslateAPI(trimmed, lang);

  if (translation) {
    // Store in both caches
    translationCache.set(cacheKey, translation);
    storeTranslation(cacheKey, translation);

    // Evict old entries from memory cache
    if (translationCache.size > CACHE_MAX_SIZE) {
      const firstKey = translationCache.keys().next().value;
      translationCache.delete(firstKey);
    }
  }

  return translation;
}

// Parallel batch translation with concurrency limit
async function handleBatchTranslation(texts, targetLang) {
  const results = new Array(texts.length);
  let idx = 0;

  async function worker() {
    while (idx < texts.length) {
      const i = idx++;
      try {
        const translation = await handleTranslation(texts[i], targetLang);
        results[i] = { original: texts[i], translation };
      } catch {
        results[i] = { original: texts[i], translation: null };
      }
    }
  }

  const workers = [];
  for (let w = 0; w < Math.min(BATCH_CONCURRENCY, texts.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  return results;
}

async function callTranslateAPI(text, targetLang) {
  const baseParams = new URLSearchParams({
    client: 'gtx',
    sl: 'auto',
    tl: targetLang,
    dt: 't',
  });

  let response;
  if (text.length > 500) {
    // Use POST for longer texts to avoid URL length limits
    const body = new URLSearchParams({ ...Object.fromEntries(baseParams), q: text });
    response = await fetch(TRANSLATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } else {
    baseParams.set('q', text);
    response = await fetch(`${TRANSLATE_URL}?${baseParams.toString()}`);
  }

  if (!response.ok) {
    throw new Error(`Translation API returned ${response.status}`);
  }

  const data = await response.json();

  // Response format: [[["translated text","original text",...], ...], ...]
  if (data && data[0]) {
    const translated = data[0]
      .filter(segment => segment && segment[0])
      .map(segment => segment[0])
      .join('');
    return translated || null;
  }

  return null;
}

// ---- Persistent Cache (chrome.storage.local) with eviction ----
async function getStoredTranslation(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      if (chrome.runtime.lastError) { resolve(null); return; }
      resolve(result[key] || null);
    });
  });
}

function storeTranslation(key, value) {
  chrome.storage.local.set({ [key]: value }, () => {
    if (chrome.runtime.lastError) {
      void chrome.runtime.lastError;
    }
  });
  // Periodically check and evict old entries
  evictStorageCacheIfNeeded();
}

let _evictPending = false;
let _storageWriteCount = 0;
async function evictStorageCacheIfNeeded() {
  if (_evictPending) return;
  _storageWriteCount++;

  // Throttle: only check every 50 writes
  if (_storageWriteCount % 50 !== 0) return;

  _evictPending = true;
  try {
    const all = await new Promise(resolve => {
      chrome.storage.local.get(null, (data) => {
        if (chrome.runtime.lastError) { resolve({}); return; }
        resolve(data || {});
      });
    });
    // Only evict translation cache keys (prefixed with 't|')
    const cacheKeys = Object.keys(all).filter(k => k.startsWith('t|'));
    if (cacheKeys.length > STORAGE_CACHE_MAX) {
      const toRemove = cacheKeys.slice(0, cacheKeys.length - STORAGE_CACHE_MAX);
      chrome.storage.local.remove(toRemove, () => void chrome.runtime.lastError);
    }
  } catch {}
  _evictPending = false;
}

// ---- Icon with status dot (cached) ----
chrome.storage.sync.get('ssSettings', (data) => {
  if (chrome.runtime.lastError) return;
  const settings = data.ssSettings || DEFAULT_SETTINGS;
  updateIcon(settings.enabled);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') return; // Only react to sync storage changes
  if (changes.ssSettings) {
    const newSettings = changes.ssSettings.newValue;
    if (newSettings) {
      updateIcon(newSettings.enabled);
      // Broadcast to all content scripts
      chrome.tabs.query({}, (tabs) => {
        if (chrome.runtime.lastError) return;
        for (const tab of tabs) {
          chrome.tabs.sendMessage(tab.id, {
            type: 'settingsUpdated',
            settings: newSettings
          }).catch(() => {});
        }
      });
    }
  }
});

async function updateIcon(enabled, _retries = 0) {
  try {
    const cacheKey = enabled ? 'enabled' : 'disabled';

    // Return cached icon if available
    if (iconCache[cacheKey]) {
      chrome.action.setIcon({ imageData: iconCache[cacheKey] }, () => void chrome.runtime.lastError);
      return;
    }

    const sizes = [16, 48];
    const imageDataMap = {};

    for (const size of sizes) {
      const canvas = new OffscreenCanvas(size, size);
      const ctx = canvas.getContext('2d');

      // Load base icon
      const resp = await fetch(chrome.runtime.getURL(`icons/icon${size}.png`));
      const blob = await resp.blob();
      const bmp = await createImageBitmap(blob);
      ctx.drawImage(bmp, 0, 0, size, size);

      // Grey out icon when disabled — two-tone like the status dot
      // Dark pixels (letter strokes, outer bg) → black (outline)
      // Light pixels (gold rect fill) → #7D7D7D grey (matches dot fill)
      if (!enabled) {
        const imgData = ctx.getImageData(0, 0, size, size);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
          const g = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
          // Dark pixels (letters, background) → black; light pixels (gold rect) → grey
          const v = g < 80 ? 0 : 0x7D;
          d[i] = v;
          d[i + 1] = v;
          d[i + 2] = v;
        }
        ctx.putImageData(imgData, 0, 0);
      }

      // Draw status dot in bottom-right corner
      const s = size / 16;
      const dotR = 1.9 * s;
      const cx = size - dotR - 0.4 * s;
      const cy = size - dotR - 0.4 * s;

      ctx.beginPath();
      ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
      ctx.fillStyle = enabled ? '#F1D871' : '#7D7D7D';
      ctx.fill();
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 0.8 * s;
      ctx.stroke();

      imageDataMap[size] = ctx.getImageData(0, 0, size, size);
    }

    // Cache the rendered icon
    iconCache[cacheKey] = imageDataMap;

    chrome.action.setIcon({ imageData: imageDataMap }, () => void chrome.runtime.lastError);
  } catch (err) {
    // Retry once — service worker may have been waking up during first attempt
    if (_retries < 1) {
      setTimeout(() => updateIcon(enabled, _retries + 1), 200);
    }
  }
}

// ---- Install ----
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get('ssSettings', (data) => {
    if (chrome.runtime.lastError) return;
    if (!data.ssSettings) {
      chrome.storage.sync.set({ ssSettings: DEFAULT_SETTINGS }, () => void chrome.runtime.lastError);
    }
  });
  updateIcon(true);
});
