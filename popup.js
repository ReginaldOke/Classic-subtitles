// ============================================
// CLASSIC SUBTITLES - Popup Settings
// Reads/writes chrome.storage.sync directly
// (no service worker dependency)
// ============================================

const DEFAULTS = {
  enabled: true,
  fontSize: 24,
  showOriginal: false,
  showBackground: true,
  highlightMode: false,
  targetLang: 'es',
};

const els = {};
let _rangeTimer = null;

// Script is at end of <body> — DOM is already parsed, no need for DOMContentLoaded
els.enabled = document.getElementById('enabled');
els.targetLang = document.getElementById('targetLang');
els.fontSize = document.getElementById('fontSize');
els.fontSizeValue = document.getElementById('fontSizeValue');
els.showBackground = document.getElementById('showBackground');
els.highlightMode = document.getElementById('highlightMode');
els.showOriginal = document.getElementById('showOriginal');
els.settings = document.getElementById('settings');
els.status = document.getElementById('status');

// Load saved settings directly from storage
loadSettings();

// Attach event listeners
els.enabled.addEventListener('change', onSettingChange);
els.targetLang.addEventListener('change', onSettingChange);
els.fontSize.addEventListener('input', () => {
  updateRangeDisplays();
  // Debounced live update while dragging
  clearTimeout(_rangeTimer);
  _rangeTimer = setTimeout(onSettingChange, 100);
});
els.fontSize.addEventListener('change', onSettingChange);
els.showBackground.addEventListener('change', onSettingChange);
els.highlightMode.addEventListener('change', onSettingChange);
els.showOriginal.addEventListener('change', onSettingChange);

function loadSettings() {
  // Read directly from storage — works even if service worker is dormant
  chrome.storage.sync.get('ssSettings', (data) => {
    if (chrome.runtime.lastError) {
      applyToUI(DEFAULTS);
      return;
    }
    applyToUI(data.ssSettings || DEFAULTS);
  });
}

function applyToUI(settings) {
  els.enabled.checked = settings.enabled !== false;
  els.targetLang.value = settings.targetLang || 'es';
  els.fontSize.value = settings.fontSize || 24;
  els.showBackground.checked = settings.showBackground || false;
  els.highlightMode.checked = settings.highlightMode || false;
  els.showOriginal.checked = settings.showOriginal || false;

  updateRangeDisplays();
  updateUIState(settings.enabled !== false);
}

function updateRangeDisplays() {
  els.fontSizeValue.textContent = els.fontSize.value + 'px';
}

function updateUIState(enabled) {
  els.settings.style.opacity = enabled ? '1' : '0.4';
  els.settings.style.pointerEvents = enabled ? 'auto' : 'none';
  els.status.textContent = enabled ? 'Active' : 'Paused';
  els.status.className = 'status' + (enabled ? '' : ' paused');
}

function onSettingChange() {
  const settings = {
    enabled: els.enabled.checked,
    targetLang: els.targetLang.value,
    fontSize: parseInt(els.fontSize.value, 10),
    showBackground: els.showBackground.checked,
    highlightMode: els.highlightMode.checked,
    showOriginal: els.showOriginal.checked,
  };

  updateUIState(settings.enabled);

  // Write directly to storage — background detects change via onChanged
  // and broadcasts to all tabs + updates icon
  chrome.storage.sync.set({ ssSettings: settings });
}
