/**
 * Services name genres differently ("Hip-Hop/Rap", "Rap & Hip-Hop", "Rap/Hip Hop", "рэп"…).
 * Known spellings are folded into one Russian name so filtering and sorting by genre works
 * across sources; anything else is kept as written, just tidied up.
 */
const FAMILIES: Record<string, string[]> = {
  'Хип-хоп': ['hip-hop', 'hip hop', 'hiphop', 'rap', 'hip-hop/rap', 'rap/hip hop', 'rap & hip-hop', 'hip-hop & rap', 'рэп', 'хип-хоп', 'хип хоп', 'русский рэп', 'trap', 'трэп', 'grime', 'drill'],
  Поп: ['pop', 'поп', 'russian pop', 'русский поп', 'k-pop', 'j-pop', 'dance pop', 'synthpop', 'synth-pop', 'electropop', 'electropop & disco', 'поп-музыка'],
  Рок: ['rock', 'рок', 'hard rock', 'classic rock', 'русский рок', 'pop/rock', 'rock & roll', "rock 'n' roll", 'soft rock'],
  Альтернатива: ['alternative', 'alternative rock', 'альтернатива', 'альтернативный рок', 'grunge', 'post-punk', 'emo'],
  Инди: ['indie', 'indie pop', 'indie rock', 'инди', 'инди-поп', 'инди-рок'],
  Электроника: ['electronic', 'electronica', 'electro', 'электроника', 'электронная музыка', 'idm', 'edm', 'electronic music'],
  Танцевальная: ['dance', 'dance & house', 'dance & edm', 'dance/electronic', 'танцевальная', 'танцевальная музыка', 'disco', 'диско'],
  Хаус: ['house', 'deep house', 'tech house', 'progressive house', 'хаус'],
  Техно: ['techno', 'техно', 'minimal techno'],
  Транс: ['trance', 'транс', 'psytrance', 'progressive trance'],
  'Драм-н-бейс': ['drum & bass', 'drum and bass', 'drum n bass', 'dnb', 'd&b', 'jungle', 'драм-н-бейс', 'драм-энд-бейс'],
  Дабстеп: ['dubstep', 'дабстеп', 'bass', 'bass music'],
  Эмбиент: ['ambient', 'эмбиент', 'chillout', 'chill', 'downtempo', 'easy listening'],
  'Лоу-фай': ['lo-fi', 'lofi', 'lo fi', 'lo-fi hip hop', 'лоу-фай'],
  'R&B и соул': ['r&b', 'rnb', 'r&b/soul', 'r&b & soul', 'soul', 'soul & funk', 'funk', 'neo-soul', 'соул', 'фанк'],
  Джаз: ['jazz', 'джаз', 'jazz & blues', 'smooth jazz'],
  Блюз: ['blues', 'блюз'],
  Классика: ['classical', 'classical music', 'классика', 'классическая музыка', 'opera', 'опера'],
  Метал: ['metal', 'heavy metal', 'метал', 'death metal', 'black metal', 'metalcore', 'nu metal'],
  Панк: ['punk', 'punk rock', 'панк', 'панк-рок', 'pop punk'],
  Регги: ['reggae', 'регги', 'dancehall', 'dub', 'ska'],
  Фолк: ['folk', 'фолк', 'singer-songwriter', 'singer/songwriter', 'acoustic', 'acoustic & vocal', 'акустика', 'ethnic', 'этника', 'world', 'world music'],
  Кантри: ['country', 'кантри', 'americana', 'bluegrass'],
  Латино: ['latin', 'latin music', 'latino', 'латино', 'reggaeton', 'реггетон'],
  Шансон: ['chanson', 'шансон', 'русский шансон'],
  Саундтреки: ['soundtrack', 'soundtracks', 'films/games', 'film', 'score', 'саундтрек', 'саундтреки', 'video game music'],
  Фонк: ['phonk', 'фонк', 'drift phonk'],
  Инструментальная: ['instrumental', 'инструментальная', 'beats', 'piano', 'фортепиано'],
  Детская: ['kids', "children's music", 'детская', 'детская музыка'],
  'Аудиокниги и подкасты': ['speech', 'spoken', 'audiobooks', 'podcast', 'podcasts', 'речь'],
};

/** Values that say nothing about the music. */
const IGNORED = new Set(['other', 'others', 'другое', 'misc', 'unknown', 'none', 'music', 'музыка', 'all', 'all music']);

const LOOKUP = new Map<string, string>();
for (const [name, aliases] of Object.entries(FAMILIES)) {
  LOOKUP.set(name.toLocaleLowerCase(), name);
  for (const alias of aliases) LOOKUP.set(alias, name);
}

const key = (value: string) =>
  value
    .toLocaleLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[_]+/g, ' ')
    .replace(/\s*([/&-])\s*/g, ' $1 ')
    .replace(/\s+/g, ' ')
    .trim();

for (const [alias, name] of [...LOOKUP]) LOOKUP.set(key(alias), name);

export function normalizeGenre(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\s+/g, ' ').trim().replace(/^#\s*/, '');
  if (!cleaned || cleaned.length > 50) return null;
  const k = key(cleaned);
  if (IGNORED.has(k)) return null;
  const known = LOOKUP.get(k);
  if (known) return known;
  return cleaned.charAt(0).toLocaleUpperCase() + cleaned.slice(1);
}

/** Canonical genre families, for building genre pickers. */
export const KNOWN_GENRES = Object.keys(FAMILIES);
