"""生成 CareHavenIcons 子集（Font Awesome Free 7 Solid → TTF base64 SCSS）。

用法：
    python3 miniapp/scripts/gen-iconfont.py

需要系统安装 Font Awesome 7 Free Solid（Arch: ttf-font-awesome / AUR），
或通过环境变量 FA_SOLID 指向 .otf 文件。生成结果直接写入
miniapp/src/styles/iconfont.scss，仓库里提交生成产物，构建机不需要字体。
"""

import base64
import os
import sys
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

SRC = os.environ.get("FA_SOLID", "/usr/share/fonts/OTF/Font Awesome 7 Free-Solid-900.otf")
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "src/styles/iconfont.scss"

# 与 miniapp/src/lib/icons.ts 保持一致；新增图标时两边同时改。
ICONS = {
    "house": 0xF015,
    "spa": 0xF5BB,
    "comment-dots": 0xF27B,
    "users": 0xF0C0,
    "chart-line": 0xF201,
    "user": 0xF007,
    "clipboard-check": 0xF46C,
    "clipboard-list": 0xF46D,
    "hand-holding-heart": 0xF4BE,
    "heart-pulse": 0xF21E,
    "cloud-rain": 0xF73D,
    "brain": 0xF5DC,
    "wind": 0xF72E,
    "music": 0xF001,
    "video": 0xF03D,
    "puzzle-piece": 0xF12E,
    "star": 0xF005,
    "circle-check": 0xF058,
    "triangle-exclamation": 0xF071,
    "bell": 0xF0A2,
    "sun": 0xF185,
    "moon": 0xF186,
    "calendar-days": 0xF073,
    "chevron-right": 0xF054,
    "chevron-down": 0xF078,
    "arrow-right": 0xF061,
    "arrow-left": 0xF060,
    "play": 0xF04B,
    "rotate-right": 0xF2F9,
    "book-open": 0xF518,
    "magnifying-glass": 0xF002,
    "paper-plane": 0xF1D8,
    "circle-question": 0xF059,
    "lightbulb": 0xF0EB,
    "screwdriver-wrench": 0xF7D9,
    "thumbs-up": 0xF087,
    "comment": 0xF075,
    "pen-to-square": 0xF044,
    "plus": 0xF067,
    "download": 0xF019,
    "trash-can": 0xF014,
    "lock": 0xF023,
    "circle-info": 0xF05A,
    "shield-heart": 0xE574,
    "leaf": 0xF06C,
    "seedling": 0xF4D8,
    "face-smile": 0xF118,
    "face-meh": 0xF11A,
    "face-frown": 0xF119,
    "face-angry": 0xF556,
    "face-grin-beam": 0xF582,
    "person-walking": 0xF554,
    "bed": 0xF236,
    "mug-hot": 0xF7B6,
    "headphones": 0xF025,
    "list-check": 0xF0AE,
    "circle-plus": 0xF055,
    "xmark": 0xF00D,
    "clock": 0xF017,
    "circle-exclamation": 0xF06A,
    "heart": 0xF004,
    "circle-xmark": 0xF057,
    "check": 0xF00C,
    "phone": 0xF095,
    "volume-high": 0xF028,
}


def build_ttf(src: TTFont) -> bytes:
    cmap = src.getBestCmap()
    inverse = {cp: glyph for cp, glyph in cmap.items()}
    glyph_set = src.getGlyphSet()
    upem = src["head"].unitsPerEm
    ascent = src["hhea"].ascent
    descent = src["hhea"].descent

    glyphs = {".notdef": TTGlyphPen(None).glyph()}
    metrics = {".notdef": (512, 0)}
    order = [".notdef"]
    mapping = {}

    for icon, codepoint in ICONS.items():
        glyph_name = inverse.get(codepoint)
        if glyph_name is None:
            sys.exit(f"缺失图标：{icon} ({codepoint:#x})")
        pen = TTGlyphPen(glyph_set)
        glyph_set[glyph_name].draw(Cu2QuPen(pen, max_err=1.0, reverse_direction=True))
        glyphs[glyph_name] = pen.glyph()
        advance, side_bearing = src["hmtx"][glyph_name]
        metrics[glyph_name] = (advance, side_bearing)
        order.append(glyph_name)
        mapping[codepoint] = glyph_name

    builder = FontBuilder(upem, isTTF=True)
    builder.setupGlyphOrder(order)
    builder.setupCharacterMap(mapping)
    builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics(metrics)
    builder.setupHorizontalHeader(ascent=ascent, descent=descent)
    builder.setupNameTable(
        {
            "familyName": "CareHavenIcons",
            "styleName": "Regular",
            "uniqueFontIdentifier": "CareHavenIcons-Regular",
            "fullName": "CareHavenIcons Regular",
            "psName": "CareHavenIcons-Regular",
            "version": "Version 1.0",
        }
    )
    builder.setupOS2(
        sTypoAscender=ascent,
        sTypoDescender=descent,
        usWinAscent=ascent,
        usWinDescent=-descent,
    )
    builder.setupPost()

    tmp = ROOT / "scripts/.icons.ttf"
    builder.save(str(tmp))
    data = tmp.read_bytes()
    tmp.unlink()
    return data


def main() -> None:
    src = TTFont(SRC)
    data = build_ttf(src)
    encoded = base64.b64encode(data).decode("ascii")
    css = f"""// 图标字体（Font Awesome Free 7 Solid 子集）—— 由 scripts/gen-iconfont.py 生成。
// 只保留界面实际用到的 {len(ICONS)} 个图标；字形为实心轮廓，跨 iOS/Android/桌面渲染一致。
// 许可：图标 CC BY 4.0，字体 SIL OFL 1.1 —— 见 docs/icon-license.md。
@font-face {{
  font-family: 'CareHavenIcons';
  src: url('data:font/ttf;base64,{encoded}') format('truetype');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}}

.icon {{
  font-family: 'CareHavenIcons', sans-serif;
  font-style: normal;
  font-weight: normal;
  line-height: 1;
  display: inline-block;
  vertical-align: -0.08em;
  -webkit-font-smoothing: antialiased;
}}
"""
    OUT.write_text(css)
    print(f"wrote {OUT} ({len(ICONS)} glyphs, {len(data)} bytes ttf)")


if __name__ == "__main__":
    main()
