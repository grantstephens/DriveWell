/**
 * Colors, not layout. background/surface/text/muted/accent/border plus the
 * leaf's brown and green stops (domain/leaf.ts owns the interpolation; those
 * two entries are the same colors, restated here so palettes stay one file).
 */
export interface Theme {
  dark: boolean;
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  accent: string;
  border: string;
}

export const lightTheme: Theme = {
  dark: false,
  background: '#FFFFFF',
  surface: '#F2F2F2',
  text: '#1C1C1E',
  textMuted: '#6E6E73',
  accent: '#2E7D32',
  border: '#D1D1D6',
};

export const darkTheme: Theme = {
  dark: true,
  // #121212, not black: Android's own Material dark-theme spec - pure black
  // makes elevated surfaces indistinguishable and halos on OLED motion blur.
  background: '#121212',
  surface: '#1E1E1E',
  text: '#E5E5E7',
  textMuted: '#9B9BA1',
  accent: '#81C784',
  border: '#2C2C2E',
};
