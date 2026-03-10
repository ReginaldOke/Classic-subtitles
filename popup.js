// ============================================
// CLASSIC SUBTITLES - Popup Settings
// Reads/writes chrome.storage.sync directly
// (no service worker dependency)
// ============================================

// ---- Language list (single source of truth, alphabetical) ----
const LANGUAGES = [
  { code: 'ar', name: 'Arabic' },
  { code: 'zh', name: 'Chinese' },
  { code: 'cs', name: 'Czech' },
  { code: 'da', name: 'Danish' },
  { code: 'nl', name: 'Dutch' },
  { code: 'en', name: 'English' },
  { code: 'fi', name: 'Finnish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'el', name: 'Greek' },
  { code: 'hi', name: 'Hindi' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'id', name: 'Indonesian' },
  { code: 'it', name: 'Italian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'no', name: 'Norwegian' },
  { code: 'pl', name: 'Polish' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ro', name: 'Romanian' },
  { code: 'ru', name: 'Russian' },
  { code: 'es', name: 'Spanish' },
  { code: 'sv', name: 'Swedish' },
  { code: 'th', name: 'Thai' },
  { code: 'tr', name: 'Turkish' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'vi', name: 'Vietnamese' },
];

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
let _selectedLang = 'es';

// Safety net: ensure popup is always visible even if something errors
setTimeout(() => document.body.classList.add('ready'), 150);

// Script is at end of <body> — DOM is already parsed, no need for DOMContentLoaded
els.enabled = document.getElementById('enabled');
els.fontSize = document.getElementById('fontSize');
els.fontSizeValue = document.getElementById('fontSizeValue');
els.showBackground = document.getElementById('showBackground');
els.highlightMode = document.getElementById('highlightMode');
els.showOriginal = document.getElementById('showOriginal');
els.settings = document.getElementById('settings');
els.status = document.getElementById('status');

// Custom dropdown elements
els.langSelect = document.getElementById('langSelect');
els.langTrigger = document.getElementById('langTrigger');
els.langLabel = document.getElementById('langLabel');
els.langDropdown = document.getElementById('langDropdown');
els.langSearch = document.getElementById('langSearch');
els.langList = document.getElementById('langList');

// Build language list and load settings
buildLangList();
loadSettings();

// Attach event listeners
els.enabled.addEventListener('change', onSettingChange);
els.fontSize.addEventListener('input', () => {
  updateRangeDisplays();
  clearTimeout(_rangeTimer);
  _rangeTimer = setTimeout(onSettingChange, 100);
});
els.fontSize.addEventListener('change', onSettingChange);
els.showBackground.addEventListener('change', onSettingChange);
els.highlightMode.addEventListener('change', onSettingChange);
els.showOriginal.addEventListener('change', onSettingChange);

// ---- Custom dropdown handlers ----
els.langTrigger.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleDropdown();
});

els.langSearch.addEventListener('input', () => {
  filterLangs(els.langSearch.value);
});

// Prevent clicks inside dropdown from closing it
els.langDropdown.addEventListener('click', (e) => {
  e.stopPropagation();
});

// Close on outside click
document.addEventListener('click', () => {
  closeDropdown();
});

// Close on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDropdown();
});

// ---- Dropdown functions ----
function buildLangList(filter) {
  const frag = document.createDocumentFragment();
  const q = (filter || '').toLowerCase().trim();
  let count = 0;

  for (const lang of LANGUAGES) {
    if (q && !lang.name.toLowerCase().includes(q)) continue;
    count++;
    const div = document.createElement('div');
    div.className = 'lang-option' + (lang.code === _selectedLang ? ' selected' : '');
    div.dataset.code = lang.code;
    div.innerHTML = '<span>' + lang.name + '</span><span class="check">\u2713</span>';
    div.addEventListener('click', () => selectLang(lang.code));
    frag.appendChild(div);
  }

  if (count === 0) {
    const empty = document.createElement('div');
    empty.className = 'lang-empty';
    empty.textContent = 'No languages found';
    frag.appendChild(empty);
  }

  els.langList.innerHTML = '';
  els.langList.appendChild(frag);
}

function filterLangs(query) {
  buildLangList(query);
}

function toggleDropdown() {
  const isOpen = els.langSelect.classList.contains('open');
  if (isOpen) {
    closeDropdown();
  } else {
    openDropdown();
  }
}

function openDropdown() {
  els.langSelect.classList.add('open');
  els.langSearch.value = '';
  buildLangList();
  // Focus search and scroll selected into view
  setTimeout(() => {
    els.langSearch.focus();
    const sel = els.langList.querySelector('.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }, 0);
}

function closeDropdown() {
  els.langSelect.classList.remove('open');
}

function selectLang(code) {
  _selectedLang = code;
  const lang = LANGUAGES.find(l => l.code === code);
  els.langLabel.textContent = lang ? lang.name : code;
  closeDropdown();
  onSettingChange();
}

function getLangName(code) {
  const lang = LANGUAGES.find(l => l.code === code);
  return lang ? lang.name : code;
}

// ---- Settings functions ----
function loadSettings() {
  chrome.storage.sync.get('ssSettings', (data) => {
    if (chrome.runtime.lastError) {
      applyToUI(DEFAULTS);
    } else {
      applyToUI(data.ssSettings || DEFAULTS);
    }
    document.body.classList.add('ready');
  });
}

function applyToUI(settings) {
  els.enabled.checked = settings.enabled !== false;
  _selectedLang = settings.targetLang || 'es';
  els.langLabel.textContent = getLangName(_selectedLang);
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
    targetLang: _selectedLang,
    fontSize: parseInt(els.fontSize.value, 10),
    showBackground: els.showBackground.checked,
    highlightMode: els.highlightMode.checked,
    showOriginal: els.showOriginal.checked,
  };

  updateUIState(settings.enabled);

  chrome.storage.sync.set({ ssSettings: settings });
  chrome.runtime.sendMessage({ type: 'updateIcon', enabled: settings.enabled }).catch(() => {});
}
