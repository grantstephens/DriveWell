import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';

import { darkTheme, lightTheme, type Theme } from './theme';

/**
 * The app follows the system color scheme, full stop — no stored override.
 * A driving app is glanced at, not dwelt in; matching the OS is the least
 * surprising behavior and one fewer thing to store.
 */
const ThemeReactContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  const theme = useMemo<Theme>(() => (scheme === 'dark' ? darkTheme : lightTheme), [scheme]);
  return <ThemeReactContext.Provider value={theme}>{children}</ThemeReactContext.Provider>;
}

export function useTheme(): Theme {
  const value = useContext(ThemeReactContext);
  if (value === null) {
    throw new Error('useTheme must be used inside a ThemeProvider');
  }
  return value;
}
