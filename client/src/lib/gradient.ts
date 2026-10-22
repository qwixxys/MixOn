/** Stable colourful gradient for tracks/users without artwork. */
export function gradientFor(seed: string | number): string {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const hue = Math.abs(h) % 360;
  const hue2 = (hue + 40 + (Math.abs(h >> 8) % 80)) % 360;
  return `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${hue2} 75% 40%))`;
}
