import {
  argbFromHex,
  argbFromRgb,
  DynamicScheme,
  Hct,
  hexFromArgb,
  MaterialDynamicColors,
  QuantizerCelebi,
  SchemeContent,
  SchemeExpressive,
  SchemeFidelity,
  SchemeFruitSalad,
  SchemeMonochrome,
  SchemeNeutral,
  SchemeRainbow,
  SchemeTonalSpot,
  SchemeVibrant,
  Score,
} from '@material/material-color-utilities';

export type SchemeVariant =
  | 'tonalSpot'
  | 'vibrant'
  | 'expressive'
  | 'fidelity'
  | 'content'
  | 'neutral'
  | 'monochrome'
  | 'rainbow'
  | 'fruitSalad';

const SCHEMES: Record<SchemeVariant, new (source: Hct, isDark: boolean, contrast: number) => DynamicScheme> = {
  tonalSpot: SchemeTonalSpot,
  vibrant: SchemeVibrant,
  expressive: SchemeExpressive,
  fidelity: SchemeFidelity,
  content: SchemeContent,
  neutral: SchemeNeutral,
  monochrome: SchemeMonochrome,
  rainbow: SchemeRainbow,
  fruitSalad: SchemeFruitSalad,
};

/** MD3 colour roles exposed as `--md-sys-color-<kebab-name>` custom properties. */
const ROLES = [
  'primary',
  'onPrimary',
  'primaryContainer',
  'onPrimaryContainer',
  'inversePrimary',
  'primaryFixed',
  'primaryFixedDim',
  'onPrimaryFixed',
  'onPrimaryFixedVariant',
  'secondary',
  'onSecondary',
  'secondaryContainer',
  'onSecondaryContainer',
  'tertiary',
  'onTertiary',
  'tertiaryContainer',
  'onTertiaryContainer',
  'error',
  'onError',
  'errorContainer',
  'onErrorContainer',
  'background',
  'onBackground',
  'surface',
  'onSurface',
  'surfaceVariant',
  'onSurfaceVariant',
  'surfaceDim',
  'surfaceBright',
  'surfaceContainerLowest',
  'surfaceContainerLow',
  'surfaceContainer',
  'surfaceContainerHigh',
  'surfaceContainerHighest',
  'inverseSurface',
  'inverseOnSurface',
  'outline',
  'outlineVariant',
  'shadow',
  'scrim',
] as const;

export type ColorRole = (typeof ROLES)[number];

export function buildScheme(seedHex: string, variant: SchemeVariant, isDark: boolean, contrast: number): DynamicScheme {
  return new SCHEMES[variant](Hct.fromInt(argbFromHex(seedHex)), isDark, contrast);
}

export function roleHex(scheme: DynamicScheme, role: ColorRole): string {
  return hexFromArgb(MaterialDynamicColors[role].getArgb(scheme));
}

export function schemeToCssVars(scheme: DynamicScheme): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const role of ROLES) {
    vars[`--md-sys-color-${role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`] = roleHex(scheme, role);
  }
  return vars;
}

/** Picks the most suitable theme colour from an image, as Material You does with wallpapers. */
export async function seedFromImage(url: string): Promise<string | null> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  try {
    await img.decode();
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, size, size);
    // Throws for cross-origin images served without CORS headers.
    const data = ctx.getImageData(0, 0, size, size).data;
    const pixels: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 255) pixels.push(argbFromRgb(data[i], data[i + 1], data[i + 2]));
    }
    const [best] = Score.score(QuantizerCelebi.quantize(pixels, 128));
    return best === undefined ? null : hexFromArgb(best);
  } catch {
    return null;
  }
}
