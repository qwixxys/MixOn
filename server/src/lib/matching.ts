/** Helpers for matching the same song across services with differently written titles. */

export function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const NOISE = /\b(feat|ft|featuring|prod|official|video|audio|lyrics?|lyric video|remaster(ed)?|explicit|clean|radio edit|visualizer|mv|hq|hd)\b/i;

/** Drops decorations that Genius titles never have: "(feat. X)", "[Official Video]", "- Remastered 2011". */
export function cleanTitle(title: string): string {
  return title
    .replace(/[([][^)\]]*[)\]]/g, (part) => (NOISE.test(part) ? ' ' : part))
    .replace(/\s+-\s+.*\b(remaster(ed)?|version|edit|mono|stereo)\b.*$/i, '')
    .replace(/\s+(feat|ft)\.?\s.+$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The main performer from strings like "A feat. B", "A, B", "A & B", "A x B". */
export function primaryArtist(artist: string): string {
  return artist.split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bx\b|\bи\b|\bwith\b)\s*/i)[0]?.trim() || artist;
}

/** 2 for equal strings, 1 when one contains the other, 0 otherwise. */
export function closeness(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 2;
  return a.includes(b) || b.includes(a) ? 1 : 0;
}
