// 汉堡菜单变形动画：hamburger → close
// 参照 web 端 MenuIcon.svelte：两根"面包条"用不同 cubic-bezier 分别控制位移和旋转，
// 时序上位移先于旋转，呈现"先收拢再交叉"的层次感。
//
// 注意：必须用 reanimated 原生 API，不能用 moti（release 模式下与 reanimated 4.5 死锁）。
import React, { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
  interpolate,
} from "react-native-reanimated";

// 位移缓动：先快后慢（收拢动作干脆）
const EASE_DISPLACE = Easing.bezier(0.65, 0, 0.35, 1);
// 旋转缓动：先慢后快再慢（交叉动作有弹性）
const EASE_ROTATE = Easing.bezier(0.83, 0, 0.17, 1);

const LINE_W = 20;
const LINE_H = 2;
const LINE_GAP = 5;
// 位移距离：两根线在中心交汇
const OFFSET = LINE_GAP / 2 + LINE_H / 2;
const DURATION = 320;
const STAGGER = 70; // 旋转延迟于位移的时序差

interface Props {
  open: boolean;
  color: string;
  size?: number;
}

export function HamburgerIcon({ open, color, size = 22 }: Props) {
  // 用两个独立 shared value 实现位移与旋转的错峰时序
  const displace = useSharedValue(0);
  const rotate = useSharedValue(0);

  useEffect(() => {
    if (open) {
      // 展开→X：位移先动，旋转延迟跟上
      displace.value = withTiming(1, { duration: DURATION, easing: EASE_DISPLACE });
      rotate.value = withDelay(STAGGER, withTiming(1, { duration: DURATION, easing: EASE_ROTATE }));
    } else {
      // X→收起：旋转先归位，位移延迟跟上（反向层次）
      rotate.value = withTiming(0, { duration: DURATION, easing: EASE_ROTATE });
      displace.value = withDelay(STAGGER, withTiming(0, { duration: DURATION, easing: EASE_DISPLACE }));
    }
  }, [open]);

  const topStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(displace.value, [0, 1], [0, OFFSET]) },
      { rotate: `${interpolate(rotate.value, [0, 1], [0, 45])}deg` },
    ],
  }));

  const bottomStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(displace.value, [0, 1], [0, -OFFSET]) },
      { rotate: `${interpolate(rotate.value, [0, 1], [0, -45])}deg` },
    ],
  }));

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Animated.View
        style={[styles.line, { backgroundColor: color, width: LINE_W, height: LINE_H }, topStyle]}
      />
      <Animated.View
        style={[styles.line, { backgroundColor: color, width: LINE_W, height: LINE_H }, bottomStyle]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    gap: LINE_GAP,
  },
  line: {
    borderRadius: 1,
  },
});
