// 主题系统：替代现有 CSS 变量，提供角色主题色 + 亮暗模式

// 解析主题模式：system 模式下跟随系统设置。
// useColorScheme() 可能返回 null（初始渲染或设备不支持暗色模式检测），
// 此时默认使用 light 而非 dark，避免系统明明是浅色却显示深色。
export function resolveThemeMode(
  themeMode: "dark" | "light" | "system",
  systemScheme: string | null | undefined
): "dark" | "light" {
  if (themeMode !== "system") return themeMode;
  return systemScheme === "dark" ? "dark" : "light";
}

export interface ThemeColors {
  page: string;
  pageRgb: string;
  panel: string;
  text: string;
  muted: string;
  line: string;
  brand: string;
  brandRgb: string;
  brandReadable: string;
  brandContrast: string;
  composer: string;
  userBubble: string;
  assistantBubble: string;
}

const darkBase: ThemeColors = {
  page: "#1d1f24",
  pageRgb: "29,31,36",
  panel: "rgba(30,33,40,0.92)",
  text: "#e8eaed",
  muted: "#9aa0a6",
  line: "rgba(255,255,255,0.08)",
  brand: "#ED86A1",
  brandRgb: "237,134,161",
  brandReadable: "#ED86A1",
  brandContrast: "#ffffff",
  composer: "rgba(30,33,40,0.88)",
  userBubble: "#2d3a2e",
  assistantBubble: "rgba(255,255,255,0.06)",
};

const lightBase: ThemeColors = {
  page: "#f5f6f8",
  pageRgb: "245,246,248",
  panel: "rgba(255,255,255,0.92)",
  text: "#1a1a2e",
  muted: "#6b7280",
  line: "rgba(0,0,0,0.08)",
  brand: "#ED86A1",
  brandRgb: "237,134,161",
  brandReadable: "#B85C75",
  brandContrast: "#ffffff",
  composer: "rgba(255,255,255,0.88)",
  userBubble: "#e8f5e9",
  assistantBubble: "rgba(0,0,0,0.04)",
};

export function getTheme(mode: "dark" | "light", profileThemeColor?: string): ThemeColors {
  const base = mode === "dark" ? darkBase : lightBase;
  if (!profileThemeColor) return base;
  // 角色主题色覆盖 brand 系列
  const hex = profileThemeColor.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return {
    ...base,
    brand: profileThemeColor,
    brandRgb: `${r},${g},${b}`,
    brandReadable: mode === "dark" ? profileThemeColor : darken(profileThemeColor, 0.25),
    brandContrast: luminance(r, g, b) > 0.5 ? "#1a1a2e" : "#ffffff",
  };
}

function darken(hex: string, amount: number): string {
  const c = hex.replace("#", "");
  const r = Math.max(0, Math.round(parseInt(c.slice(0, 2), 16) * (1 - amount)));
  const g = Math.max(0, Math.round(parseInt(c.slice(2, 4), 16) * (1 - amount)));
  const b = Math.max(0, Math.round(parseInt(c.slice(4, 6), 16) * (1 - amount)));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function luminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
