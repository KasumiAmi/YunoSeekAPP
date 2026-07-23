#!/usr/bin/env python3
"""
生成 Android 图标和 splash 资源：
- mipmap-*/ic_launcher.webp（标准图标）
- mipmap-*/ic_launcher_round.webp（圆形图标）
- mipmap-*/ic_launcher_foreground.webp（自适应图标前景图）
- mipmap-*/ic_launcher_monochrome.webp（莫奈取色图标）
- drawable-*/splashscreen_logo.png（splash logo）
"""
import os
from PIL import Image, ImageDraw

RES = os.path.join(os.path.dirname(__file__), "..", "android", "app", "src", "main", "res")
ASSETS = os.path.join(os.path.dirname(__file__), "..", "assets")

MIPMAP_SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
FOREGROUND_SIZES = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
SPLASH_SIZES = {"mdpi": 96, "hdpi": 144, "xhdpi": 192, "xxhdpi": 288, "xxxhdpi": 384}

icon = Image.open(os.path.join(ASSETS, "icon.png")).convert("RGBA")
# 居中裁切为正方形，避免非正方形原图被拉伸变形
side = min(icon.size)
left = (icon.width - side) // 2
top = (icon.height - side) // 2
icon = icon.crop((left, top, left + side, top + side))
adaptive = Image.open(os.path.join(ASSETS, "adaptive-icon.png")).convert("RGBA")
mono = Image.open(os.path.join(ASSETS, "monochrome-icon.png")).convert("RGBA")
splash_logo = Image.open(os.path.join(ASSETS, "about-logo.png")).convert("RGBA")
print(f"icon: {icon.size}, adaptive: {adaptive.size}, mono: {mono.size}, splash: {splash_logo.size}")

for dpi in MIPMAP_SIZES:
    dir_path = os.path.join(RES, f"mipmap-{dpi}")
    size = MIPMAP_SIZES[dpi]
    fg_size = FOREGROUND_SIZES[dpi]

    # ic_launcher.webp
    launcher = icon.resize((size, size), Image.LANCZOS)
    launcher.save(os.path.join(dir_path, "ic_launcher.webp"), "WEBP")

    # ic_launcher_round.webp（圆形裁切）
    round_img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
    round_img.paste(launcher, (0, 0), mask)
    round_img.save(os.path.join(dir_path, "ic_launcher_round.webp"), "WEBP")

    # ic_launcher_foreground.webp
    fg = adaptive.resize((fg_size, fg_size), Image.LANCZOS)
    fg.save(os.path.join(dir_path, "ic_launcher_foreground.webp"), "WEBP")

    # ic_launcher_monochrome.webp
    mono_scaled = mono.resize((fg_size, fg_size), Image.LANCZOS)
    mono_scaled.save(os.path.join(dir_path, "ic_launcher_monochrome.webp"), "WEBP")

    # splashscreen_logo.png（按宽高比缩放）
    splash_size = SPLASH_SIZES[dpi]
    ratio = splash_logo.width / splash_logo.height
    if ratio > 1:
        w, h = splash_size, int(splash_size / ratio)
    else:
        h, w = splash_size, int(splash_size * ratio)
    splash = splash_logo.resize((w, h), Image.LANCZOS)
    splash.save(os.path.join(RES, f"drawable-{dpi}", "splashscreen_logo.png"), "PNG")

    print(f"  {dpi}: launcher={size}px, fg={fg_size}px, splash={w}x{h}px")

print("完成")
