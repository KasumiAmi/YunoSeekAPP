// 放送日程时间计算（与 web 端 public/lib/anime-schedule-time.js 对齐）
// 节目每周四 22:00（北京时间 UTC+8）开播，首播连播 premiereEpisodeCount 话
// 使用 Asia/Shanghai 时区显式计算，避免设备时区差异

const dayMs = 86_400_000;
const weekMs = 7 * dayMs;
const thursdayIndex = 4;
const broadcastHour = 22; // 北京时间 22:00
const broadcastDurationMs = 24 * 60_000; // 直播窗口 24 分钟

interface ScheduleEpisode {
  number: number;
  titleZh?: string;
  titleJa?: string;
  status?: string;
  airDate?: string;
  staff?: Record<string, string> | string;
}

interface Schedule {
  premiereDate?: string;
  premiereEpisodeCount?: number;
  episodes?: ScheduleEpisode[];
}

interface BroadcastState {
  live: boolean;
  targetAt: number; // 下次开播时间（UTC ms）
  episodeAt: number; // 当前/下次播出对应的播出时间
  remainingMs: number;
}

// 获取北京时间各部分（年月日时分秒）
function beijingNowParts(now = new Date()): Record<string, number> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const result: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") result[p.type] = Number(p.value);
  }
  return result;
}

// 北京时间 → UTC ms（减 8 小时）
function beijingDateUtcMs(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number {
  return Date.UTC(year, month - 1, day, hour - 8, minute, second);
}

// 解析 "YYYY-MM-DD" 格式的北京时间日期 → UTC ms（当天 broadcastHour:00 北京时间）
function beijingDateStringUtcMs(value: string, hour = broadcastHour, minute = 0): number | null {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return beijingDateUtcMs(Number(match[1]), Number(match[2]), Number(match[3]), hour, minute);
}

// 计算本周四（北京时间）00:00 的 UTC ms
function thursdayStartUtcMs(now: Date): number {
  const parts = beijingNowParts(now);
  const todayStart = beijingDateUtcMs(parts.year, parts.month, parts.day);
  const currentWeekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12)).getUTCDay();
  const daysSinceThursday = (currentWeekday - thursdayIndex + 7) % 7;
  return todayStart - daysSinceThursday * dayMs;
}

// 根据播出时间计算对应的集数（首播日连播 premiereEpisodeCount 话，之后每周一话）
export function episodeNumberForBroadcast(schedule: Schedule | null | undefined, broadcastAt: number): number | null {
  if (!schedule?.premiereDate) return null;
  const premiereAt = beijingDateStringUtcMs(schedule.premiereDate);
  if (!premiereAt || !Number.isFinite(broadcastAt) || broadcastAt < premiereAt) return null;
  const premiereEpisodeCount = Math.max(1, Number(schedule.premiereEpisodeCount) || 3);
  const weeksSincePremiere = Math.round((broadcastAt - premiereAt) / weekMs);
  return weeksSincePremiere <= 0 ? 1 : premiereEpisodeCount + weeksSincePremiere;
}

// 当前播出状态：是否在直播窗口内，以及下次开播时间
export function animeBroadcastState(now = new Date()): BroadcastState {
  const thisThursdayStart = thursdayStartUtcMs(now);
  const thisBroadcast = thisThursdayStart + broadcastHour * 3_600_000;
  const nowMs = now.getTime();
  if (nowMs >= thisBroadcast && nowMs < thisBroadcast + broadcastDurationMs) {
    return { live: true, targetAt: thisBroadcast, episodeAt: thisBroadcast, remainingMs: 0 };
  }
  const targetAt = nowMs < thisBroadcast ? thisBroadcast : thisBroadcast + weekMs;
  return { live: false, targetAt, episodeAt: targetAt, remainingMs: Math.max(0, targetAt - nowMs) };
}

// 根据播出状态查找对应的集数信息
export function nextScheduleEpisode(
  schedule: Schedule | null | undefined,
  broadcastState: BroadcastState = animeBroadcastState(),
): ScheduleEpisode | null {
  if (!schedule?.episodes?.length) return null;
  const episodes = [...schedule.episodes].sort((a, b) => Number(a.number) - Number(b.number));
  const expectedNumber = episodeNumberForBroadcast(schedule, broadcastState.episodeAt);
  if (expectedNumber !== null) {
    return episodes.find((ep) => Number(ep.number) === expectedNumber) || null;
  }
  return episodes.find((ep) => ep.status && ep.status !== "aired") || episodes[episodes.length - 1] || null;
}

// 格式化倒计时：HH:MM:SS 或 Xd HH:MM:SS
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const fmt = (n: number) => String(n).padStart(2, "0");
  const time = `${fmt(hours)}:${fmt(minutes)}:${fmt(seconds)}`;
  return days > 0 ? `${days}d ${time}` : time;
}
