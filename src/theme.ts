import { argbFromHex, hexFromArgb, themeFromSourceColor } from '@material/material-color-utilities';
import { MD3DarkTheme, MD3LightTheme, type MD3Theme } from 'react-native-paper';

/**
 * The whole app's color system, generated from one seed: the lush-green stop
 * of the leaf's own brown-to-green scale (domain/leaf.ts). That scale stays
 * completely independent of this file — it communicates driving quality,
 * not brand identity — but seeding the Material palette from the same green
 * ties the app's visual identity to the one thing it's actually about.
 *
 * `@material/material-color-utilities` is Google's own implementation of the
 * Material 3 color algorithm (the same one behind the Material Theme
 * Builder web tool and Android 12+'s wallpaper-based dynamic color) — a
 * pure-JS/TS library with no native code, deliberately chosen over
 * packages like `@pchmn/expo-material3-theme` that bundle a native module
 * for *system* wallpaper theming this app has no use for and that would
 * complicate the zero-native-surprises permission story in AGENTS.md.
 *
 * Every generated color role (primary/secondary/tertiary, their "on" and
 * "container" pairs, surfaces, outline, error) is accessibility-checked by
 * the algorithm itself — hand-picking a dozen-plus hex codes to the same
 * standard is not a thing to do by eye.
 */
const SEED_COLOR = '#2E7D32';

/** toHexColors converts one generated ARGB color-role scheme to hex strings. */
function toHexColors(scheme: { toJSON(): Record<string, number> }): Record<string, string> {
  const hex: Record<string, string> = {};
  for (const [role, argb] of Object.entries(scheme.toJSON())) {
    hex[role] = hexFromArgb(argb);
  }
  return hex;
}

const generated = themeFromSourceColor(argbFromHex(SEED_COLOR));

/**
 * Paper's own MD3LightTheme/MD3DarkTheme supply every color role the type
 * requires (elevation overlays, disabled states, backdrop, …); spreading the
 * generated roles on top only replaces the ones the algorithm actually
 * produced, so nothing is ever missing.
 */
export const lightTheme: MD3Theme = {
  ...MD3LightTheme,
  colors: { ...MD3LightTheme.colors, ...toHexColors(generated.schemes.light) },
};

export const darkTheme: MD3Theme = {
  ...MD3DarkTheme,
  colors: { ...MD3DarkTheme.colors, ...toHexColors(generated.schemes.dark) },
};

export type Theme = MD3Theme;
