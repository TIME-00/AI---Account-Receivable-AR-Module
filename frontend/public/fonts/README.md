# Bundled PDF font

`NotoSansCJKsc-Regular.otf` is Noto Sans CJK Simplified Chinese Regular from
the official Noto CJK repository:

https://github.com/notofonts/noto-cjk/blob/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf

- License: SIL Open Font License 1.1 (see `OFL-NotoSansCJK.txt`)
- SHA-256: `2C76254F6FC379FDDFCE0A7E84FB5385BB135D3E399294F6EEB6680D0365B74B`
- Runtime use: loaded from the application’s own `/fonts/` path only when a
  report PDF is generated. No remote or system font is used.

This pan-CJK OpenType font is bundled to provide deterministic Simplified
Chinese, Traditional Chinese, Japanese, and Latin glyph coverage in PDF
exports.
