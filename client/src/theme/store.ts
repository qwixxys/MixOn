import { create } from 'zustand';
import { usePlayer } from '../store/player';
import { buildScheme, roleHex, schemeToCssVars, seedFromImage, type SchemeVariant } from './scheme';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemePrefs {
  mode: ThemeMode;
  /** Source colour the palettes are generated from. */
  seed: string;
  variant: SchemeVariant;
  /** MD3 contrast level: 0 standard, 0.5 medium, 1 high. */
  contrast: number;
  /** Use the artwork of the playing track as the source colour. */
  fromCover: boolean;
}

export const DEFAULT_THEME: ThemePrefs = {
  mode: 'system',
  seed: '#ff5500',
  variant: 'vibrant',
  contrast: 0,
  fromCover: false,
};

interface ThemeState extends ThemePrefs {
  /** Colour extracted from the current cover, when `fromCover` is on and extraction worked. */
  coverSeed: string | null;
  isDark: boolean;
  update(prefs: Partial<ThemePrefs>): void;
  reset(): void;
}

const PREFS_KEY = 'soundfy.theme';
/** Last applied variables; index.html applies them before the app loads to avoid a flash. */
const CSS_KEY = 'soundfy.theme.css';

function loadPrefs(): ThemePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_THEME, ...JSON.parse(raw) };
  } catch {
    // unavailable storage or bad JSON
  }
  return DEFAULT_THEME;
}

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const resolveDark = (mode: ThemeMode) => mode === 'dark' || (mode === 'system' && darkQuery.matches);

export const useTheme = create<ThemeState>((set, get) => {
  const prefs = loadPrefs();
  return {
    ...prefs,
    coverSeed: null,
    isDark: resolveDark(prefs.mode),
    update(patch) {
      const next = { ...pick(get()), ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      set({ ...next, isDark: resolveDark(next.mode), coverSeed: next.fromCover ? get().coverSeed : null });
      if (next.fromCover) void followCover();
    },
    reset() {
      get().update(DEFAULT_THEME);
    },
  };
});

function pick(s: ThemePrefs): ThemePrefs {
  return { mode: s.mode, seed: s.seed, variant: s.variant, contrast: s.contrast, fromCover: s.fromCover };
}

/** The colour actually used: the cover's when following covers, otherwise the chosen one. */
export function activeSeed(s: Pick<ThemeState, 'seed' | 'fromCover' | 'coverSeed'>) {
  return s.fromCover && s.coverSeed ? s.coverSeed : s.seed;
}

function apply(s: ThemeState) {
  const scheme = buildScheme(activeSeed(s), s.variant, s.isDark, s.contrast);
  const vars = schemeToCssVars(scheme);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.style.setProperty('color-scheme', s.isDark ? 'dark' : 'light');
  root.dataset.theme = s.isDark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', roleHex(scheme, 'surfaceContainer'));
  try {
    localStorage.setItem(CSS_KEY, root.getAttribute('style') ?? '');
  } catch {
    // ignore
  }
}

// ---------- colours from the playing track's cover ----------

const coverCache = new Map<string, string | null>();
let coverRequest = 0;

async function followCover() {
  const url = usePlayer.getState().current?.coverUrl ?? null;
  const request = ++coverRequest;
  if (!url) return useTheme.setState({ coverSeed: null });
  if (!coverCache.has(url)) coverCache.set(url, await seedFromImage(url));
  if (request === coverRequest && useTheme.getState().fromCover) useTheme.setState({ coverSeed: coverCache.get(url) ?? null });
}

let lastCover: string | null | undefined;
usePlayer.subscribe((s) => {
  const cover = s.current?.coverUrl ?? null;
  if (cover === lastCover) return;
  lastCover = cover;
  if (useTheme.getState().fromCover) void followCover();
});

// ---------- keep the document in sync ----------

let applied = '';
function sync(s: ThemeState) {
  const key = [activeSeed(s), s.variant, s.isDark, s.contrast].join('|');
  if (key === applied) return;
  applied = key;
  apply(s);
}

useTheme.subscribe(sync);
darkQuery.addEventListener('change', () => useTheme.setState({ isDark: resolveDark(useTheme.getState().mode) }));
sync(useTheme.getState());
if (useTheme.getState().fromCover) void followCover();
