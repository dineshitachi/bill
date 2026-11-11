export const themes = {
  luxe: { label: "Canva Luxe", className: "theme-luxe" },
  corporate: { label: "Corporate", className: "theme-corporate" },
  industrial: { label: "Industrial", className: "theme-industrial" },
  thermal: { label: "Thermal receipt", className: "theme-thermal" },
  thermal58: { label: "Thermal · 58mm", className: "theme-thermal58" },
  thermal80: { label: "Thermal · 80mm", className: "theme-thermal80" },
  gst: { label: "GST Classic", className: "theme-gst" },
} as const;

export type ThemeName = keyof typeof themes;

export const appearanceThemes = {
  dark: { label: "Dark Mode" },
  slate: { label: "Slate" },
  corporate: { label: "Corporate" },
} as const;

export type AppThemeName = keyof typeof appearanceThemes;