#!/usr/bin/env python3
"""
生成 Android 自适应图标前景图 + 莫奈单色图标
- 前景图：1024x1024 画布，图标内容居中在 66% 安全区，周围透明
- 莫奈图标：1024x1024 单色白色（alpha 保留），系统根据主题着色
"""
import os
from PIL import Image

ASSETS = os.path.join(os.path.dirname(__file__), "..", "assets")

src = Image.open(os.path.join(ASSETS, "icon.png")).convert("RGBA")
print(f"原图尺寸: {src.size}")

canvas = 1024
safe = int(canvas * 0.66)  # 676px 安全区
margin = (canvas - safe) // 2  # 174px 边距

# 缩放原图到安全区（先居中裁切为正方形避免拉伸变形）
side = min(src.size)
left = (src.width - side) // 2
top = (src.height - side) // 2
src_square = src.crop((left, top, left + side, top + side))
src_scaled = src_square.resize((safe, safe), Image.LANCZOS)

# === 自适应图标前景图 ===
fg = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
fg.paste(src_scaled, (margin, margin), src_scaled)
fg_path = os.path.join(ASSETS, "adaptive-icon.png")
fg.save(fg_path)
print(f"前景图: {fg.size}, {os.path.getsize(fg_path) // 1024} KB")

# === 莫奈图标（Android 13+ 主题取色） ===
# 白底图标处理：白色背景→透明，非白色像素（logo）→白色（保留 alpha）
# 这样莫奈图层只有 logo 形状，系统主题色才能正确着色
mono_scaled = src_scaled.copy()
data = mono_scaled.getdata()
new_data = []
for (r, g, b, a) in data:
    if a == 0:
        new_data.append((255, 255, 255, 0))           # 透明保持透明
    elif r > 240 and g > 240 and b > 240:
        new_data.append((255, 255, 255, 0))           # 白色背景→透明
    else:
        new_data.append((255, 255, 255, a))           # logo 像素→白色
mono_scaled.putdata(new_data)

mono = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
mono.paste(mono_scaled, (margin, margin), mono_scaled)
mono_path = os.path.join(ASSETS, "monochrome-icon.png")
mono.save(mono_path)
print(f"莫奈图标: {mono.size}, {os.path.getsize(mono_path) // 1024} KB")
print("完成")
