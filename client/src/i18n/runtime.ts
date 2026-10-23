// The interface language. Texts are written in Russian; the build wraps them in __t (see client/i18n/transform.ts),
// which swaps in the English text from en.ts when English is chosen. The choice applies on the next page load, so
// texts built once when a module loads (labels, menus) change with everything else.
import { beforeLeave } from '../lib/standalone';
import { EN } from './en';

export type Lang = 'ru' | 'en';

const KEY = 'soundfy.lang';

/** Russian for Russian-speaking systems, English for the rest, unless chosen in «Оформление». */
function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'ru' || saved === 'en') return saved;
  } catch {
    // storage unavailable: follow the system
  }
  const preferred = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]);
  return preferred.some((l) => /^(ru|uk|be|kk)\b/i.test(l ?? '')) ? 'ru' : 'en';
}

export const lang: Lang = detect();
/** For Intl: dates, numbers, sorting. */
export const locale = lang === 'en' ? 'en-US' : 'ru-RU';
// No prototype, so data such as a genre called "constructor" is not mistaken for a translation.
const dict: Record<string, string> | null = lang === 'en' ? Object.assign(Object.create(null), EN) : null;

if (typeof document !== 'undefined') document.documentElement.lang = lang;

/** Saves the choice and reloads, so every text is built in the new language. */
export async function setLang(next: Lang) {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // storage unavailable: the choice cannot outlive the reload below
  }
  if (next === lang) return;
  // On the phone the data is saved a moment after it changes; the reload must not take the last changes with it.
  await beforeLeave();
  location.reload();
}

const fill = (text: string, args: readonly unknown[]) => text.replace(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)] ?? ''));

/** A text from the source, with {0}, {1}… filled in. Calls are added by the build, not written by hand. */
export function __t(key: string, args?: readonly unknown[]): string {
  const text = dict?.[key] ?? key;
  return args ? fill(text, args) : text;
}

/** Patterns for the texts with values in them ("{0} не настроен на сервере"), built on first use. */
let patterns: { re: RegExp; text: string }[] | null = null;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Text that comes as data — an error or a note from the server, a genre — in the chosen language when the dictionary
 * has it. Texts with values in them are matched against the dictionary's patterns, and the values translated too
 * ("VK Музыка не настроен на сервере" → "VK Music is not set up on the server").
 */
export function tr(text: string): string;
export function tr(text: string | null | undefined): string | null | undefined;
export function tr(text: string | null | undefined) {
  if (!dict || !text) return text;
  const exact = dict[text];
  if (exact !== undefined) return exact;
  // The most specific first: "Сервис недоступен: {0}" before "{0}: {1}".
  patterns ??= Object.keys(dict)
    .filter((key) => /\{\d+\}/.test(key))
    .sort((a, b) => b.replace(/\{\d+\}/g, '').length - a.replace(/\{\d+\}/g, '').length)
    .map((key) => ({
      re: new RegExp(`^${key.split(/\{\d+\}/).map(escape).join('([\\s\\S]+?)')}$`),
      text: dict[key],
    }));
  for (const { re, text: target } of patterns) {
    const m = re.exec(text);
    if (m) return fill(target, m.slice(1).map((value) => tr(value)));
  }
  // Validation messages name the field: "username: минимум 3 символа".
  const field = /^([\w.]+): ([\s\S]+)$/.exec(text);
  if (field) return `${field[1]}: ${tr(field[2])}`;
  // Lists such as "1.2K подписчиков · 30 треков".
  if (text.includes(' · ')) return text.split(' · ').map((part) => tr(part)).join(' · ');
  return text;
}
