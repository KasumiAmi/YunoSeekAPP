# YunoSeek APP 介绍视频 — 视觉身份

## Style Prompt
暗色电影感画布（#08080c）上，由乃粉（#EE5577）作为全局唯一强调色，6 位梦限大角色主题色在群像场景轮换辉光。flyAndBlur 错落入场（cubic-bezier(.22,1,.36,1)）配高斯模糊与边缘辉光，标题字号 ≥ 120px，正文 ≥ 20px。立绘墙半透明铺底 + 径向遮罩呼吸，所有动效衔接通过辉光遮罩 / wipe / crossfade 过渡，禁止跳切。

## Colors
- `#08080c` — 画布底色（全局背景）
- `#0f0f16` — 画布柔色（卡片 / 面板底）
- `#f6f4f8` — 主墨色（主文字）
- `rgba(246,244,248,.62)` — 次墨色（次文字）
- `rgba(246,244,248,.4)` — 弱墨色（标签 / 占位）
- `#EE5577` — 主强调色（千石由乃粉，CTA / 辉光 / 选中态）
- `rgba(238,85,119,.45)` — 强调辉光（按钮脉冲、logo 投影）
- `rgba(238,85,119,.14)` — 强调柔色（徽章底）
- `rgba(255,255,255,.08)` — 分割线（卡片边框）

6 角色主题色（场景 2 轮换）：
- 藤都子 `#9977CC`（紫）
- 千石由乃 `#EE5577`（粉，全局主色）
- 峰月律 `#4477CC`（蓝）
- 仲町阿拉蕾 `#FFEE55`（黄）
- 宫永野乃花 `#FFBBCC`（浅粉）
- 薇欧拉 `#B084CC`（紫罗兰）

## Typography
- 显示字：`"SF Pro Display","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif`
- 正文：`"Inter","SF Pro Text","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif`
- 标题 ≥ 60px（hero 标题 120px），正文 ≥ 20px，数据标签 ≥ 16px
- 数字列使用 `font-variant-numeric: tabular-nums`

## Motion
- 入场主曲线：`cubic-bezier(.22,1,.36,1)`（GSAP `expo.out` / `power3.out` 近似）
- 错落 stagger 间隔：80-120ms
- 入场时长梯度：320ms（次元素）→ 480ms（主元素）→ 640ms（标题）
- 辉光脉冲：3.2s 周期 `box-shadow` 呼吸（finite repeat，按场景时长计算）
- 场景过渡时长：0.4-0.8s
- 首元素偏移 0.1-0.3s（不在 t=0 启动）

## What NOT to Do
1. 禁止全屏线性渐变暗背景（H.264 banding，改用 radial 或 solid + 局部辉光）
2. 禁止 `repeat: -1`（无限循环破坏捕获引擎，按场景时长计算 finite repeat）
3. 禁止场景内 exit 动画（`gsap.to` opacity:0 仅允许在场景 6 末尾 fade-to-black）
4. 禁止 `Math.random()` / `Date.now()` / 异步构造 timeline（必须确定性 + 同步）
5. 禁止跳切（场景间必须使用过渡层：crossfade / wipe / 辉光遮罩）
6. 禁止用 `<br>` 强制换行（用 `max-width` 自然换行，标题短词例外）
7. 禁止动画 `visibility` / `display` / 调用 `video.play()`
