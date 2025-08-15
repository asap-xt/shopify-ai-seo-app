// Simple i18n hook for Vite + React (loads JSON bundles on demand)
import { useEffect, useMemo, useState } from 'react';

const FALLBACK_LANG = 'en';

// Изрично описваме наличните локали и откъде да се зареждат
const loaders = {
  en: () => import('../i18n/en.json', { assert: { type: 'json' } }),
  de: () => import('../i18n/de.json', { assert: { type: 'json' } }),
  es: () => import('../i18n/es.json', { assert: { type: 'json' } }),
  fr: () => import('../i18n/fr.json', { assert: { type: 'json' } }),
};

export const KNOWN_LANGS = Object.keys(loaders);

// Save / read from localStorage safely
function getSavedLang() {
  try {
    const v = localStorage.getItem('app_lang');
    return KNOWN_LANGS.includes(v) ? v : null;
  } catch {
    return null;
  }
}

function setSavedLang(v) {
  try { localStorage.setItem('app_lang', v); } catch {}
}

export default function useI18n() {
  const [lang, setLang] = useState(() => getSavedLang() || FALLBACK_LANG);
  const [dict, setDict] = useState({});

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const loader = loaders[lang] || loaders[FALLBACK_LANG];
      const mod = await loader();
      if (!cancelled) setDict(mod.default || mod);
    }

    load();
    setSavedLang(lang);
    return () => { cancelled = true; };
  }, [lang]);

  // t('key', 'Default') helper
  const t = useMemo(() => {
    return (key, fallback = '') => {
      const val = key?.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), dict);
      return (val !== undefined && val !== null) ? String(val) : (fallback || key);
    };
  }, [dict]);

  return { lang, setLang, t, dict, langs: KNOWN_LANGS };
}
