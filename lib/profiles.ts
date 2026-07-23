// 6 角色数据：与 web 端 app.js profileOptions 保持一致
import { t, getLocale } from "./i18n";

export interface Profile {
  name: string;
  key: string;
  avatar: string;
  syu?: string;
  backgroundImage: string;
  themeColor: string;
  themeReadable: string;
  themeContrast: string;
  bio: { role: string; tagline: string; meta: string; likes: string; trivia: string };
}

const R2 = "https://assets.mugendai-bangdream.top";

export const profiles: Profile[] = [
  {
    name: "藤都子",
    key: "miyako",
    avatar: `${R2}/ico/miyako.png?v=20260704-1`,
    syu: `${R2}/ico/syu/miyako.webp?v=20260707-1`,
    backgroundImage: `${R2}/ico/background/img_full_fuji-miyako_01.webp?v=20260708-1`,
    themeColor: "#9977CC",
    themeReadable: "#6D4BA3",
    themeContrast: "#ffffff",
    bio: {
      role: "键盘手",
      tagline: "以「富士见夜子」名义连载漫画的键盘手，害羞却把热爱贯彻到底",
      meta: "9月19日｜处女座｜155cm｜神田白八马学院高二B班",
      likes: "甜甜圈、寿司、《魔法露露》、插花、毛绒玩具与可爱的事物",
      trivia: "平日兼顾学业、周刊连载和乐队活动，常戴着手偶「丸君」。曾因网络误解与工作压力在练习中耗尽精力，后来在野乃花和阿拉蕾的帮助下重新站稳。",
    },
  },
  {
    name: "千石由乃",
    key: "yuno",
    avatar: `${R2}/ico/yuno.png?v=20260704-1`,
    syu: `${R2}/ico/syu/yuno.webp?v=20260707-1`,
    backgroundImage: `${R2}/ico/background/img_full_sengoku-yuno_01.webp?v=20260708-1`,
    themeColor: "#EE5577",
    themeReadable: "#B83C5A",
    themeContrast: "#ffffff",
    bio: {
      role: "DJ / Manipulator",
      tagline: "节能主义者兼独立作曲家，懒散外表下对音乐格外认真",
      meta: "11月4日｜天蝎座｜151cm｜前 supremacy 贝斯手",
      likes: "白巧克力、能量饮料、游戏、TCG、动漫漫画、Pastel*Palettes",
      trivia: "初中曾组乐队，解散后继续独立创作。加入MewType时看似兴趣缺缺，却会观察队友的异常并在关键时刻帮人理清心结；直播中常玩卡牌和射击游戏。",
    },
  },
  {
    name: "峰月律",
    key: "ritsu",
    avatar: `${R2}/ico/Ritsu.png?v=20260704-1`,
    syu: `${R2}/ico/syu/Ritsu.webp?v=20260707-1`,
    backgroundImage: `${R2}/ico/background/img_full_minetsuki-ritsu_01.webp?v=20260708-1`,
    themeColor: "#4477CC",
    themeReadable: "#2E5DA7",
    themeContrast: "#ffffff",
    bio: {
      role: "节奏吉他手",
      tagline: "认真坦率的朱叶优等生，钟爱古典与原声音乐的吉他手",
      meta: "2月7日｜水瓶座｜157cm｜朱叶女子高中高一",
      likes: "寿喜烧、拉面、明太子、观鸟、登山、看电影、古典音乐",
      trivia: "曾以「克蕾玛琪丝」名义活动，经历过La La La La Girls与妖精花束。她一直想修复与阿拉蕾的旧日关系，大胃王特质后来也被采纳进动画设定。",
    },
  },
  {
    name: "仲町阿拉蕾",
    key: "arale",
    avatar: `${R2}/ico/arale.png?v=20260704-1`,
    syu: `${R2}/ico/syu/arale.webp?v=20260707-1`,
    backgroundImage: `${R2}/ico/background/img_full_nakamachi-arale_01.webp?v=20260708-1`,
    themeColor: "#FFEE55",
    themeReadable: "#7C6B00",
    themeContrast: "#2F2900",
    bio: {
      role: "队长 / 主唱",
      tagline: "热爱动画与漫画的主唱，话很多、很温柔，也很容易被过去刺痛",
      meta: "8月16日｜狮子座｜154cm｜神田白八马学院高一",
      likes: "辣食、白饭、蛋包饭、炒面面包、动漫、anison、electro swing",
      trivia: "曾以「艾蕾亚」名义担任La La La La Girls队长，因被恶意剪辑引发炎上而转学。加入MewType后起初抗拒开口唱歌，后来因翻唱企划逐渐找回信心。",
    },
  },
  {
    name: "宫永野乃花",
    key: "nonoka",
    avatar: `${R2}/ico/Nonoka.png?v=20260704-1`,
    syu: `${R2}/ico/syu/Nonoka.webp?v=20260707-1`,
    backgroundImage: `${R2}/ico/background/img_full_miyanaga-nonoka_01.webp?v=20260708-1`,
    themeColor: "#FFBBCC",
    themeReadable: "#A65C72",
    themeContrast: "#4A1F2A",
    bio: {
      role: "主音吉他手",
      tagline: "天真烂漫的麻烦制造者，总用自己的方式把队友往前推",
      meta: "4月17日｜白羊座｜161cm｜神田白八马学院高二A班",
      likes: "白饭、炖菜、马卡龙、草莓糖、羊羹、桌游、绘本、日常系动漫",
      trivia: "5岁时因玩具吉他弹唱视频走红，长大后作为主播活动。虽然常因脱线发言引发误会，但非常在意队友状态，曾主动帮助都子和阿拉蕾化解压力。",
    },
  },
  {
    name: "薇欧拉",
    key: "viola",
    avatar: `${R2}/ico/1783858865423.jpeg`,
    backgroundImage: `${R2}/ico/img_character-main-viola.webp`,
    themeColor: "#4A5342",
    themeReadable: "#3A4234",
    themeContrast: "#ffffff",
    bio: {
      role: "妖精花束 / 前队长",
      tagline: "Viola 花语是「真诚」与「小小的幸福」，清纯楚楚的少女，柔和笑容下含蓄高雅",
      meta: "朱叶女子高中高二｜声优：本渡枫｜黑发·灰金瞳·单丸子头·猫嘴·美人痣",
      likes: "",
      trivia: "前 La La La La Girls 队长，因意见不合逼退前队长后继任。展现惊人控制欲，借录制会议恶意剪辑搞坏阿拉蕾形象，致其遭网暴退队；后拉拢律与蓓儿、波波组建妖精花束。高中时期持续操控律，拿阿拉蕾的创伤施压，曾在律直播事故后逼其开反省会。关键独白：「火种燃尽之后会怎么样呢？——周围会燃烧起来！像朋友、家人……MewType什么的！」",
    },
  },
];

export function getProfile(key: string): Profile | undefined {
  return profiles.find((p) => p.key === key);
}

export function randomProfile(excludeKey?: string): Profile {
  const pool = profiles.filter((p) => p.key !== excludeKey);
  return pool[Math.floor(Math.random() * pool.length)];
}

// 各角色引继码说明文案（与 web 端 app.js handoffPersonaLines.zh-CN.*.description 对齐）
// 用于引继码页的说明文字，按当前角色切换
const handoffDescriptionLines: Record<string, string> = {
  yuno: "这串短码会保存你的聊天记录。换设备时输入它就能接上原来的对话，别随手丢给别人。",
  miyako: "这串短码可以在新设备上取回聊天记录。那个……请像保管丸君一样，别让别人看到。",
  ritsu: "这串短码用于恢复聊天记录。换设备前请确认已经同步，并妥善保存。",
  arale: "这是把聊天记录带到新设备的小暗号！很方便，但也要好好藏起来，不能随便给别人看哦。",
  nonoka: "这串短码超方便！换设备时输入它，聊天记录就能咻地回来。记得别给陌生人看哦。",
  viola: "这串短码会保存你的聊天记录。换设备时输入它就能接上原来的对话，别随手丢给别人。",
};

export function handoffDescriptionForProfile(profileKey: string): string {
  return handoffDescriptionLines[profileKey] || handoffDescriptionLines.yuno;
}

// 各角色专属欢迎语（与 web 端 app.js profileWelcomeLines 对齐；千石由乃走 selfTalkWelcome）
const profileWelcomeLines: Record<string, Record<string, string>> = {
  "zh-CN": {
    "藤都子": "那个……我是藤都子",
    "峰月律": "你好，我是峰月律",
    "仲町阿拉蕾": "呀吼！我是仲町阿拉蕾",
    "宫永野乃花": "嗨嗨！我是宫永野乃花",
    "薇欧拉": "火种燃尽之后会怎么样呢？",
  },
  "ja-JP": {
    "藤都子": "あの……藤都子です",
    "峰月律": "こんにちは、峰月律です",
    "仲町阿拉蕾": "やっほー！仲町あられだよ",
    "宫永野乃花": "やっほー！宮永ののかだよ",
    "薇欧拉": "火種が燃え尽きるとどうなるでしょうか？",
  },
};

/**
 * 返回当前角色的欢迎标题（与 web 端 app.js welcomeTitleForProfile 对齐）。
 * 千石由乃 → selfTalkWelcome；其他角色 → profileWelcomeLines 中的专属欢迎语；
 * 找不到时回退到通用 `welcome`（嗨！我是YunoSeek）。
 */
export function welcomeTitleForProfile(profile: Profile): string {
  if (profile.name === "千石由乃") return t("selfTalkWelcome");
  const locale = getLocale();
  const lang = locale === "ja-JP" ? "ja-JP" : "zh-CN";
  const line = profileWelcomeLines[lang]?.[profile.name];
  if (line) return line;
  return t("welcome");
}
