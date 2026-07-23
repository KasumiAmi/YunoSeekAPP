// 应用启动 splash 过渡：原生 splash 关闭后用 JS splash 衔接动画
// 显示 yunoseek-logo + 当前角色立绘 + APP 名称 + 版本号
// 动画时序基于用户偏好：320ms→480ms→640ms 节奏
//
// 实现说明：
// - 改用 RN 自带 Animated API（useNativeDriver: true）
// - 不再用 moti（moti 0.30 + reanimated 4.5 在 release 下死锁，导致白屏）
// - 总时长：入场 ~1000ms + 停留 800ms + 淡出 640ms ≈ 2440ms
import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, Dimensions, useColorScheme, type ImageSourcePropType } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Constants from "expo-constants";
import { useStore } from "../lib/store";
import { getTheme, resolveThemeMode } from "../lib/theme";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

// 角色立绘本地资源映射（避免启动时网络请求；薇欧拉没有本地立绘，回退到远程 URL）
// 用户明确要求：使用 ico/background 目录下的人物立绘，不要套用角色头像（avatar）和声优照（syu）
const characterImage: Record<string, ImageSourcePropType> = {
  miyako: require("../assets/characters/img_full_fuji-miyako_01.webp"),
  yuno: require("../assets/characters/img_full_sengoku-yuno_01.webp"),
  ritsu: require("../assets/characters/img_full_minetsuki-ritsu_01.webp"),
  arale: require("../assets/characters/img_full_nakamachi-arale_01.webp"),
  nonoka: require("../assets/characters/img_full_miyanaga-nonoka_01.webp"),
};

interface Props {
  // 动画结束回调：父组件移除 splash
  onDone: () => void;
}

export function AppSplash({ onDone }: Props) {
  const profile = useStore((s) => s.getCurrentProfile());
  const themeMode = useStore((s) => s.themeMode);
  const systemScheme = useColorScheme();
  // 跟随应用主题模式（用户手动设置的浅色/深色/跟随系统）
  const mode = resolveThemeMode(themeMode, systemScheme);
  const theme = getTheme(mode, profile.themeColor);
  const appVersion = Constants.expoConfig?.version ?? "1.0.0";
  // 浅色/深色模式下的文字颜色
  const textPrimary = mode === "dark" ? "#FFFFFF" : theme.text;
  const textSecondary = mode === "dark" ? "rgba(255,255,255,0.65)" : theme.muted;
  const textTertiary = mode === "dark" ? "rgba(255,255,255,0.4)" : theme.muted;

  // Animated 值（全部用 native driver）
  const fadeOut = useRef(new Animated.Value(1)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.8)).current;
  const charOpacity = useRef(new Animated.Value(0)).current;
  const charTranslateY = useRef(new Animated.Value(24)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const textTranslateY = useRef(new Animated.Value(12)).current;
  const versionOpacity = useRef(new Animated.Value(0)).current;
  // 呼吸光斑：用 loop 循环（native driver 安全）
  const ambientOpacity = useRef(new Animated.Value(0.2)).current;

  useEffect(() => {
    // 入场 + 整体淡出编排
    const entrance = Animated.parallel([
      // Logo 缩放入场（0→1, 480ms easeOut）
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 480,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(logoScale, {
        toValue: 1,
        duration: 480,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      // 立绘淡入上移（delay 200, 480ms easeOut）
      Animated.sequence([
        Animated.delay(200),
        Animated.parallel([
          Animated.timing(charOpacity, {
            toValue: 1,
            duration: 480,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(charTranslateY, {
            toValue: 0,
            duration: 480,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ]),
      // 文字区淡入上移（delay 600, 480ms）
      Animated.sequence([
        Animated.delay(600),
        Animated.parallel([
          Animated.timing(textOpacity, {
            toValue: 1,
            duration: 480,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(textTranslateY, {
            toValue: 0,
            duration: 480,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ]),
      // 版本号淡入（delay 1000, 480ms）
      Animated.sequence([
        Animated.delay(1000),
        Animated.timing(versionOpacity, {
          toValue: 1,
          duration: 480,
          useNativeDriver: true,
        }),
      ]),
      // 整体淡出（delay 1800, 640ms easeInOut）
      Animated.sequence([
        Animated.delay(1800),
        Animated.timing(fadeOut, {
          toValue: 0,
          duration: 640,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ]);

    // 呼吸光斑（无限循环，与入场并行）
    const breathing = Animated.loop(
      Animated.sequence([
        Animated.timing(ambientOpacity, {
          toValue: 0.5,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(ambientOpacity, {
          toValue: 0.2,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    entrance.start();
    breathing.start();

    // 总时长 2440ms 后调用 onDone
    const t = setTimeout(onDone, 2440);
    return () => {
      clearTimeout(t);
      entrance.stop();
      breathing.stop();
    };
  }, [onDone, fadeOut, logoOpacity, logoScale, charOpacity, charTranslateY, textOpacity, textTranslateY, versionOpacity, ambientOpacity]);

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { opacity: fadeOut }]}
      pointerEvents="none"
    >
      {/* 渐变背景：跟随应用主题模式（浅色/深色），避免纯色块（用户偏好） */}
      <LinearGradient
        colors={mode === "dark"
          ? ["#1d1f24", "#2a2d35", "#1d1f24"]
          : [theme.page, "#e8e9ec", theme.page]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* 角色主题色光斑（呼吸效果，对应空状态 ambient） */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: ambientOpacity }]}>
        <LinearGradient
          colors={[
            `rgba(${theme.brandRgb},0.3)`,
            "transparent",
            `rgba(${theme.brandRgb},0.15)`,
          ]}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      {/* 顶部 Logo（缩放入场 0.8→1.0，480ms ease-out） */}
      <Animated.View
        style={[
          styles.logoWrap,
          {
            opacity: logoOpacity,
            transform: [{ scale: logoScale }],
          },
        ]}
      >
        <Image
          source={require("../assets/about-logo.png")}
          style={styles.logo}
          resizeMode="contain"
        />
      </Animated.View>

      {/* 中部角色立绘（淡入 + 上移，480ms 延迟 200ms）
          使用 ico/background 目录下的本地立绘（非头像 / 非声优照），
          薇欧拉没有本地立绘，回退到远程 backgroundImage */}
      <Animated.View
        style={[
          styles.characterWrap,
          {
            opacity: charOpacity,
            transform: [{ translateY: charTranslateY }],
          },
        ]}
      >
        <Image
          source={characterImage[profile.key] || { uri: profile.backgroundImage }}
          style={styles.character}
          resizeMode="contain"
          cachePolicy="memory-disk"
        />
      </Animated.View>

      {/* 文字区：APP 名称 + 副标题（淡入 480ms 延迟 600ms） */}
      <Animated.View
        style={[
          styles.textWrap,
          {
            opacity: textOpacity,
            transform: [{ translateY: textTranslateY }],
          },
        ]}
      >
        <Text style={styles.appName}>
          <Text style={{ color: textPrimary }}>Yuno</Text>
          <Text style={{ color: theme.brand }}>Seek</Text>
        </Text>
        <Text style={[styles.appTagline, { color: textSecondary }]}>{profile.name} · {profile.bio.role}</Text>
      </Animated.View>

      {/* 底部版本号（淡入 480ms 延迟 1000ms） */}
      <Animated.View
        style={[styles.bottomWrap, { opacity: versionOpacity }]}
      >
        <Text style={[styles.versionText, { color: textTertiary }]}>v{appVersion}</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  logoWrap: {
    position: "absolute",
    top: 60,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: 88,
    height: 88,
    borderRadius: 22,
  },
  characterWrap: {
    position: "absolute",
    top: 170,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    width: SCREEN_W,
    height: SCREEN_H * 0.5,
  },
  character: {
    width: SCREEN_W * 0.7,
    height: SCREEN_H * 0.5,
  },
  textWrap: {
    position: "absolute",
    bottom: 130,
    alignSelf: "center",
    alignItems: "center",
  },
  appName: {
    fontSize: 26,
    fontWeight: "700",
    marginBottom: 6,
  },
  appTagline: {
    fontSize: 13,
  },
  bottomWrap: {
    position: "absolute",
    bottom: 32,
    alignSelf: "center",
  },
  versionText: {
    fontSize: 12,
  },
});
