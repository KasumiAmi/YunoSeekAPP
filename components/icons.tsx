// SVG 图标组件：基于 react-native-svg 实现，替代 Ionicons 字体图标
// 通用图标来自 Lucide (https://lucide.dev, ISC License)
// B 站 logo 来自 Simple Icons (https://simpleicons.org, CC0 1.0)
import React from "react";
import Svg, { Path, Circle, Polyline, Line } from "react-native-svg";
import type { ColorValue } from "react-native";

interface IconProps {
  size?: number;
  color?: ColorValue;
  style?: any;
}

const stroke = (color: ColorValue) => ({
  stroke: color,
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  fill: "none",
});

// ── 信息（版本号）── Lucide info
export function InfoIcon({ size = 24, color = "#000", style }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={style}>
      <Circle cx="12" cy="12" r="10" {...stroke(color)} />
      <Path d="M12 16v-4" {...stroke(color)} />
      <Path d="M12 8h.01" {...stroke(color)} />
    </Svg>
  );
}

// ── 时钟（构建时间）── Lucide clock
export function ClockIcon({ size = 24, color = "#000", style }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={style}>
      <Circle cx="12" cy="12" r="10" {...stroke(color)} />
      <Polyline points="12 6 12 12 16 14" {...stroke(color)} />
    </Svg>
  );
}

// ── 天平（开放源代码许可，象征法律/许可）── Lucide scale
export function ScaleIcon({ size = 24, color = "#000", style }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={style}>
      <Path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" {...stroke(color)} />
      <Path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" {...stroke(color)} />
      <Path d="M7 21h10" {...stroke(color)} />
      <Path d="M12 3v18" {...stroke(color)} />
      <Path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" {...stroke(color)} />
    </Svg>
  );
}

// ── B 站 logo ── Simple Icons bilibili (fill 风格)
export function BilibiliIcon({ size = 24, color = "#000", style }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={style}>
      <Path
        fill={color as string}
        d="M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036 18.858 0 17.347v-7.36c.036-1.511.556-2.765 1.56-3.76 1.004-.996 2.262-1.52 3.773-1.574h.774l-1.174-1.12a1.234 1.234 0 0 1-.373-.906c0-.356.124-.658.373-.907l.027-.027c.267-.249.573-.373.92-.373.347 0 .653.124.92.373L9.653 4.44c.071.071.134.142.187.213h4.267a.836.836 0 0 1 .16-.213l2.853-2.747c.267-.249.573-.373.92-.373.347 0 .662.151.929.4.267.249.391.551.391.907 0 .355-.124.657-.373.906zM5.333 7.24c-.746.018-1.373.276-1.88.773-.506.498-.769 1.13-.786 1.894v7.52c.017.764.28 1.395.786 1.893.507.498 1.134.756 1.88.773h13.334c.746-.017 1.373-.275 1.88-.773.506-.498.769-1.129.786-1.893v-7.52c-.017-.765-.28-1.396-.786-1.894-.507-.497-1.134-.755-1.88-.773zM8 11.107c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c0-.373.129-.689.386-.947.258-.257.574-.386.947-.386zm8 0c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c.017-.391.15-.711.4-.96.249-.249.56-.373.933-.373Z"
      />
    </Svg>
  );
}

// ── 返回箭头 ── Lucide arrow-left
export function ArrowLeftIcon({ size = 24, color = "#000", style }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={style}>
      <Path d="m12 19-7-7 7-7" {...stroke(color)} />
      <Path d="M19 12H5" {...stroke(color)} />
    </Svg>
  );
}

// ── 右尖角（跳转入口指示）── Lucide chevron-right
export function ChevronRightIcon({ size = 24, color = "#000", style }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={style}>
      <Path d="m9 18 6-6-6-6" {...stroke(color)} />
    </Svg>
  );
}

// ── 外部链接 ── Lucide external-link
export function ExternalLinkIcon({ size = 24, color = "#000", style }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={style}>
      <Path d="M15 3h6v6" {...stroke(color)} />
      <Path d="M10 14 21 3" {...stroke(color)} />
      <Path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" {...stroke(color)} />
    </Svg>
  );
}

// ── 关闭 ── Lucide x
export function CloseIcon({ size = 24, color = "#000", style }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={style}>
      <Path d="M18 6 6 18" {...stroke(color)} />
      <Path d="m6 6 12 12" {...stroke(color)} />
    </Svg>
  );
}

// ── 活动波形（全站 Token 用量入口）── Lucide activity
export function ActivityIcon({ size = 24, color = "#000", style }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={style}>
      <Path d="M22 12h-4l-3 9L9 3l-3 9H2" {...stroke(color)} />
    </Svg>
  );
}

// ── 刷新（检查更新入口）── Lucide refresh-cw
export function RefreshIcon({ size = 24, color = "#000", style }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={style}>
      <Path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" {...stroke(color)} />
      <Path d="M21 3v5h-5" {...stroke(color)} />
      <Path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" {...stroke(color)} />
      <Path d="M3 21v-5h5" {...stroke(color)} />
    </Svg>
  );
}

// ── 下载（更新下载按钮）── Lucide download
export function DownloadIcon({ size = 24, color = "#000", style }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={style}>
      <Path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" {...stroke(color)} />
      <Polyline points="7 10 12 15 17 10" {...stroke(color)} />
      <Line x1="12" y1="15" x2="12" y2="3" {...stroke(color)} />
    </Svg>
  );
}

// ── 闪烁星（新版本提示）── Lucide sparkles
export function SparkleIcon({ size = 24, color = "#000", style }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={style}>
      <Path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" {...stroke(color)} />
      <Path d="M19 14l.7 1.9L21.6 17l-1.9.7L19 19.6l-.7-1.9L16.4 17l1.9-.7L19 14z" {...stroke(color)} />
    </Svg>
  );
}

// ── 成功圆勾（已是最新/更新就绪）── Lucide check-circle
export function CheckCircleIcon({ size = 24, color = "#000", style }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={style}>
      <Path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" {...stroke(color)} />
      <Polyline points="22 4 12 14.01 9 11.01" {...stroke(color)} />
    </Svg>
  );
}

// ── 警告三角（必须更新/检查失败）── Lucide alert-triangle
export function AlertTriangleIcon({ size = 24, color = "#000", style }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={style}>
      <Path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" {...stroke(color)} />
      <Line x1="12" y1="9" x2="12" y2="13" {...stroke(color)} />
      <Path d="M12 17h.01" {...stroke(color)} />
    </Svg>
  );
}