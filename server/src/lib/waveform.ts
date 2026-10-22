export const WAVEFORM_BARS = 120;

/**
 * Deterministic pseudo-waveform for tracks whose audio we cannot analyse
 * (external streams, or uploads where the browser could not decode the file).
 */
export function syntheticWaveform(seed: string | number, bars = WAVEFORM_BARS): number[] {
  let h = 2166136261;
  for (const ch of String(seed)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  const rand = () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 10000) / 10000;
  };
  const out: number[] = [];
  let level = 0.5;
  for (let i = 0; i < bars; i++) {
    // Smooth random walk with a fade-in / fade-out envelope, so it reads like music.
    level = Math.min(1, Math.max(0.15, level + (rand() - 0.5) * 0.35));
    const envelope = Math.min(1, (i + 4) / 12, (bars - i + 2) / 10);
    out.push(Math.round(Math.max(0.08, level * envelope * (0.75 + rand() * 0.25)) * 1000) / 1000);
  }
  return out;
}

/** Validates and normalises a client-supplied waveform. Returns null if unusable. */
export function normalizeWaveform(input: unknown): number[] | null {
  if (!Array.isArray(input) || input.length < 16 || input.length > 1000) return null;
  const values = input.map(Number);
  if (values.some((v) => !Number.isFinite(v) || v < 0)) return null;
  const max = Math.max(...values) || 1;
  return values.map((v) => Math.round((v / max) * 1000) / 1000);
}
