#!/usr/bin/env python3
# 生成原生 tabBar 图标（81x81 PNG，透明背景）。
# 设计系统：UI-UX Pro Max Agriculture/Farm Tech × Organic Biophilic
# 普通色 #64748B（muted-foreground），选中色 #15803D（primary）。
# 用法：python wechat/smart_farm/tools/gen-tabbar-icons.py
import os
from PIL import Image, ImageDraw

SIZE = 81
SCALE = 4
S = SIZE * SCALE
STROKE = 7 * SCALE

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', 'assets', 'tabbar'))

COLORS = {'normal': '#64748B', 'active': '#15803D'}


def canvas():
    return Image.new('RGBA', (S, S), (0, 0, 0, 0))


def save(img, name):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name + '.png')
    img.resize((SIZE, SIZE), Image.LANCZOS).save(path, 'PNG')
    print('wrote', path)


def draw_overview(draw, color):
    pad = 12 * SCALE
    gap = 8 * SCALE
    cell = (S - pad * 2 - gap) // 2
    radius = 6 * SCALE
    for row in range(2):
        for col in range(2):
            x = pad + col * (cell + gap)
            y = pad + row * (cell + gap)
            draw.rounded_rectangle(
                [x, y, x + cell, y + cell], radius=radius, outline=color, width=STROKE
            )


def draw_provision(draw, color):
    cx, cy = S // 2, int(S * 0.70)
    for r in (int(S * 0.16), int(S * 0.28), int(S * 0.40)):
        draw.arc(
            [cx - r, cy - r, cx + r, cy + r],
            start=208,
            end=332,
            fill=color,
            width=STROKE,
        )
    dot = int(STROKE * 0.85)
    draw.ellipse([cx - dot, cy - dot, cx + dot, cy + dot], fill=color)


def draw_settings(draw, color):
    xs = int(S * 0.16)
    xe = int(S * 0.84)
    rows = [int(S * 0.28), int(S * 0.50), int(S * 0.72)]
    knobs = [int(S * 0.38), int(S * 0.66), int(S * 0.46)]
    r = int(STROKE * 0.95)
    for y, kx in zip(rows, knobs):
        draw.line([xs, y, xe, y], fill=color, width=STROKE)
        draw.ellipse([kx - r, y - r, kx + r, y + r], fill=color)


def draw_security(draw, color):
    cx = S // 2
    top = int(S * 0.14)
    left = int(S * 0.16)
    right = int(S * 0.84)
    shoulder = int(S * 0.42)
    bottom = int(S * 0.88)
    mid = int(S * 0.70)
    points = [
        (cx, top),
        (right, shoulder),
        (right, mid),
        (cx, bottom),
        (left, mid),
        (left, shoulder),
        (cx, top),
    ]
    draw.line(points, fill=color, width=STROKE, joint='curve')
    # 内部对勾
    draw.line(
        [(int(S * 0.36), int(S * 0.48)), (int(S * 0.47), int(S * 0.59)), (int(S * 0.66), int(S * 0.36))],
        fill=color,
        width=STROKE,
        joint='curve',
    )


def main():
    icons = {
        'overview': draw_overview,
        'provision': draw_provision,
        'settings': draw_settings,
        'security': draw_security,
    }
    for name, fn in icons.items():
        for state, color in COLORS.items():
            img = canvas()
            fn(ImageDraw.Draw(img), color)
            suffix = '' if state == 'normal' else '-active'
            save(img, name + suffix)


if __name__ == '__main__':
    main()
