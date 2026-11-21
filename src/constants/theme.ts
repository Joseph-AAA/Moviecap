import "@/global.css";

import { Platform } from "react-native";

export const Colors = {
  light: {
    text: "#17151F",
    background: "#F8F7FC",
    backgroundElement: "#EEEAF5",
    backgroundSelected: "#E5DDF5",
    textSecondary: "#777181",
  },
  dark: {
    text: "#FFFFFF",
    background: "#101014",
    backgroundElement: "#1C1B24",
    backgroundSelected: "#262432",
    textSecondary: "#A1A1AA",
  },
} as const;

export const MovieCapColors = {
  primary: "#8B5CF6",
  primaryLight: "#A78BFA",
  background: "#101014",
  card: "#1C1B24",
  elevated: "#262432",
  text: "#FFFFFF",
  secondaryText: "#A1A1AA",
  border: "#34313F",
  success: "#22C55E",
  danger: "#EF4444",
};

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    sans: "system-ui",
    serif: "ui-serif",
    rounded: "ui-rounded",
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "var(--font-display)",
    serif: "var(--font-serif)",
    rounded: "var(--font-rounded)",
    mono: "var(--font-mono)",
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset =
  Platform.select({
    ios: 50,
    android: 80,
  }) ?? 0;

export const MaxContentWidth = 800;
