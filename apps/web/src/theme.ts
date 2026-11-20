export type ThemePref = 'auto' | 'light' | 'dark';
export type Theme = 'light' | 'dark';
const KEY = 'pp.theme';

export function getPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch { return 'auto'; }
}

export function effectiveTheme(pref: ThemePref = getPref()): Theme {
  if (pref !== 'auto') return pref;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function applyTheme(): void {
  document.documentElement.dataset.theme = effectiveTheme();
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
}

export function setPref(pref: ThemePref): void {
  try { localStorage.setItem(KEY, pref); } catch { /* geen opslag: dan geldt het alleen nu */ }
  applyTheme();
}

/** Volgt de systeeminstelling zolang de voorkeur "auto" is. */
export function watchSystemTheme(onChange: () => void): void {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (getPref() === 'auto') { applyTheme(); onChange(); }
  });
}
