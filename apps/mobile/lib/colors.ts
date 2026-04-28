import * as SecureStore from 'expo-secure-store';
import {
  createElement,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from 'react';
import {
  StyleSheet,
  useColorScheme,
  type ImageStyle,
  type TextStyle,
  type ViewStyle
} from 'react-native';

const THEME_PREFERENCE_KEY = 'mobile-theme-preference';

export const lightColors = {
  background: '#f4f4f5',
  foreground: '#09090b',
  card: '#ffffff',
  cardForeground: '#09090b',
  primary: '#2563eb',
  primaryForeground: '#ffffff',
  secondary: '#e4e4e7',
  secondaryForeground: '#52525b',
  muted: '#e4e4e7',
  mutedForeground: '#71717a',
  border: '#d4d4d8',
  destructive: '#dc2626',
  success: '#16a34a'
} as const;

export const darkColors = {
  background: '#09090b',
  foreground: '#fafafa',
  card: '#111113',
  cardForeground: '#fafafa',
  primary: '#3b82f6',
  primaryForeground: '#ffffff',
  secondary: '#1e1e22',
  secondaryForeground: '#a1a1aa',
  muted: '#27272a',
  mutedForeground: '#71717a',
  border: '#27272a',
  destructive: '#ef4444',
  success: '#22c55e'
} as const;

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
export type ThemeColors = {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  destructive: string;
  success: string;
};

type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

type ThemeContextValue = {
  colors: ThemeColors;
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const colors = darkColors;

function resolveThemePreference(
  preference: ThemePreference,
  systemScheme: ReturnType<typeof useColorScheme>
): ResolvedTheme {
  if (preference === 'system') {
    return systemScheme === 'light' ? 'light' : 'dark';
  }

  return preference;
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    let cancelled = false;

    SecureStore.getItemAsync(THEME_PREFERENCE_KEY)
      .then(value => {
        if (cancelled) return;
        if (value === 'light' || value === 'dark' || value === 'system') {
          setPreferenceState(value);
        }
      })
      .catch(error => {
        if (__DEV__) {
          console.warn('[ThemeProvider] Failed to load theme preference:', error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const resolvedTheme = resolveThemePreference(preference, systemScheme);
  const currentColors = resolvedTheme === 'light' ? lightColors : darkColors;

  const contextValue = useMemo<ThemeContextValue>(
    () => ({
      colors: currentColors,
      preference,
      resolvedTheme,
      async setPreference(nextPreference) {
        setPreferenceState(nextPreference);

        if (nextPreference === 'system') {
          await SecureStore.deleteItemAsync(THEME_PREFERENCE_KEY);
          return;
        }

        await SecureStore.setItemAsync(THEME_PREFERENCE_KEY, nextPreference, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
        });
      }
    }),
    [currentColors, preference, resolvedTheme]
  );

  return createElement(ThemeContext.Provider, { value: contextValue }, children);
}

function useThemeContext() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('Theme hooks must be used within ThemeProvider.');
  }

  return context;
}

export function useThemeColors() {
  return useThemeContext().colors;
}

export function useThemePreference() {
  const { preference, resolvedTheme, setPreference } = useThemeContext();

  return { preference, resolvedTheme, setPreference };
}

export function useThemedStyles<T extends NamedStyles<T>>(factory: (colors: ThemeColors) => T) {
  const currentColors = useThemeColors();

  return useMemo(() => StyleSheet.create(factory(currentColors)), [currentColors, factory]);
}
