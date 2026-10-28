// Bundled, full-character fonts. Font loading stays local to the app.
export const FONT_CATALOG = [
  {
    "family": "Book Mincho",
    "name": "Noto Serif JP Regular",
    "label": "明朝 · Noto Serif JP",
    "path": "fonts/NotoSerifJP-Regular.otf",
    "license": "fonts/OFL.txt",
    "format": "opentype",
    "sha256": "2c9a12dbd4f2408c4610c7ee84a108b62d7236c3775baed618c64d9cb44b2f04",
    "source": "https://github.com/notofonts/noto-cjk"
  },
  {
    "family": "Shippori Mincho",
    "name": "しっぽり明朝",
    "label": "明朝 · しっぽり明朝",
    "path": "fonts/ShipporiMincho-Regular.woff2",
    "license": "fonts/ShipporiMincho-Regular-OFL.txt",
    "format": "woff2",
    "sha256": "a43a59fdbc4f38afba12d607f65e78c521f80ae1551d49f7aefff52cc7835baf",
    "source": "https://raw.githubusercontent.com/google/fonts/main/ofl/shipporimincho/ShipporiMincho-Regular.ttf"
  },
  {
    "family": "Zen Kaku Gothic New",
    "name": "ZEN角ゴシック New",
    "label": "ゴシック · ZEN角ゴシック",
    "path": "fonts/ZenKakuGothicNew-Regular.woff2",
    "license": "fonts/ZenKakuGothicNew-Regular-OFL.txt",
    "format": "woff2",
    "sha256": "2f796e317b519d2b6fc8d286ef1acbc887af7cd8921fb17a0ebd83d98e8f32d5",
    "source": "https://raw.githubusercontent.com/google/fonts/main/ofl/zenkakugothicnew/ZenKakuGothicNew-Regular.ttf"
  },
  {
    "family": "Zen Maru Gothic",
    "name": "ZEN丸ゴシック",
    "label": "丸ゴシック · ZEN丸ゴシック",
    "path": "fonts/ZenMaruGothic-Regular.woff2",
    "license": "fonts/ZenMaruGothic-Regular-OFL.txt",
    "format": "woff2",
    "sha256": "0fbbe44c230f4ad9ad6988a87bb8e2d20548275851b4432275ce1a06291d64d7",
    "source": "https://raw.githubusercontent.com/google/fonts/main/ofl/zenmarugothic/ZenMaruGothic-Regular.ttf"
  },
  {
    "family": "Zen Old Mincho",
    "name": "ZENオールド明朝",
    "label": "明朝 · ZENオールド明朝",
    "path": "fonts/ZenOldMincho-Regular.woff2",
    "license": "fonts/ZenOldMincho-Regular-OFL.txt",
    "format": "woff2",
    "sha256": "a6b0b4314c9d1281ff0478f26c263772442a936ad3f364c2a5439ad0af31f16c",
    "source": "https://raw.githubusercontent.com/google/fonts/main/ofl/zenoldmincho/ZenOldMincho-Regular.ttf"
  },
  {
    "family": "Noto Sans JP",
    "name": "Noto Sans JP",
    "label": "ゴシック · Noto Sans JP",
    "path": "fonts/NotoSansJP-Regular.woff2",
    "license": "fonts/NotoSansJP-Regular-OFL.txt",
    "format": "woff2",
    "sha256": "cb4ec4ad654d645499a8318d09f57f7ed2f0732d8275e0fc520aae5a101881a1",
    "source": "https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf"
  },
  {
    "family": "GenEi Koburi Mincho",
    "name": "源暎こぶり明朝",
    "label": "明朝 · 源暎こぶり明朝",
    "path": "fonts/GenEiKoburiMin6-R.ttf",
    "license": "fonts/GenEiKoburiMin6-R-OFL.txt",
    "format": "truetype",
    "sha256": "c27fb4039ac9fae19152716992b5b9d07558e24f6cccea7b0c1abd0109235166",
    "source": "https://okoneya.jp/font/genei-koburimin.html"
  }
] as const;
export function fontDefinition(family: string) {
  const font = FONT_CATALOG.find(font => font.family === family);
  if (!font) throw new Error('未対応の書体です。');
  return font;
}
