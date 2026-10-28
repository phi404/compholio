# 開発

## 起動と構成

Node.js 24を推奨します。npm ci後にnpm run devで開発用、npm run buildとnpm run serveで静的ビルドを起動します。

TypeScriptとHTML/CSSで構成しています。本文処理は端末内のWorker、紙面描画はSVG、出力は同じ確定ページを使います。

| 場所 | 役割 |
| --- | --- |
| src/domain | 文書・設定・参照の検証と編集 |
| src/typesetting | 行・段・ページの分割 |
| src/render | 確定した紙面のSVG |
| src/io | 読み込み・端末保存・PNG/PDF/ZIP |
| src/ui | 操作・履歴・プレビュー |
| src/app | Workerと起動の接続 |

Book Modelが正本です。原稿はその編集用表現、ページ番号や座標は組版の結果です。通常本文の例外は構造やスタイルで表し、自由配置は自由ページに限ります。GUIと原稿で設定を二重に持たせません。

JSONの外側のschemaVersionは3、文書ツリーは2です。これは別の構造の版番号です。過去の作業形式や制作ZIPへの自動変換はありません。素材原本、未完入力、安定IDを保ち、未知の保存構造を黙って落とさないでください。

原稿・素材を外部へ送信しません。書体、PDF.js、必要な資源は同梱します。表示用のテーマやパネル幅を本の組版設定へ混ぜません。

## 検証

```sh
npm run verify:harness
npm run verify
```

前者はlint、依存境界、テスト方針、tsc --noEmit、公開文書・fixture・要件の整合を検査します。後者はビルド、機能テスト、操作4分割、Firefox/WebKit、固定画面の比較、実際に保存したPNG/PDFの解析、目視記録まで実行します。

Python 3.12、requirements-qa.txt、Popplerを用意してください。Pythonの実行パスはCOMPHOLIO_PYTHONで指定できます。ブラウザーはnpx playwright install chromium firefox webkitで導入します。バージョンはpackage-lock.jsonに固定しています。

全体検証ではローカルで保管する参照資料の指紋も照合します。初回は `node scripts/check-local-sources.mjs --init` で基準を記録します。原本を照合する場合はその相対パスを続けて指定します。

目視記録はローカルのoutput/review/manual.jsonに置きます。`node scripts/check-manual.mjs --init`で未確認のひな形を作れます。現在のソース指紋、確認者、環境、5項目の結果と証拠がそろうまで全体ゲートは通りません。生成物やレビュー本文をコミットする必要はありません。

結果はoutput/verificationに終了コード、環境、ソース指紋とともに残ります。コードや期待値を変えた後に古い成功を流用しないでください。固定画像の更新は差分を個別に見てから行い、通常の比較を再実行します。

不具合は再現する入力と修正前に失敗するテストを作ってから直します。検査の省略、skip、閾値の緩和、無条件の再試行で通さないでください。禁則の期待値は実装からコピーせず独立したものを使います。

縦書き字形の生成は `node scripts/vertical-font.mjs`、照合は `node scripts/vertical-font.mjs --check`。fontkitは開発時だけ使います。

テストはtests/product、tests/e2e、tests/compatibilityにあります。操作はtests/e2e/ui-driver.mjsへ集約しています。fixturesは合成した検証用原稿です。未公開の利用者原稿を追加しないでください。

## 配布

GitHubリポジトリはphi404/compholio、試用ページはhttps://phi404.github.io/compholio/です。GitHub Actionsは自動検査に成功したdistだけをPagesへ配置します。ローカルとCIで同じ機能・操作・PDF検査を使い、CIの成功と人間による確認を分けます。

資源は配置ディレクトリ基準の相対URLを使います。配下URLでWorker・書体・PDF素材・ZIPの保存を検査してください。Pagesには原稿や端末内の保存データを配置しません。

公開文書はREADME、この手順、使い方に絞っています。開発時の調査・判断・過去の仕様・検証の詳細はローカルに保管し、公開対象から外しています。利用者に必要な制約は使い方へ書きます。

## 同梱物

配布元、版、ファイル指紋は各manifest、ライセンスは各配布物の原文を参照してください。

| 依存物 | 配布元・ライセンス |
| --- | --- |
| 同梱書体7種 | [書体と出典](../public/fonts/NOTICE.txt) / 各OFL |
| pdf-lib | [公式リポジトリ](https://github.com/Hopding/pdf-lib) / [MIT](../public/vendor/pdf-lib.LICENSE.md) |
| PDF.js | [Mozilla](https://github.com/mozilla/pdf.js) / public/vendor/pdfjs/README.mdと同梱ライセンス |
| fflate | [公式リポジトリ](https://github.com/101arrowz/fflate) / [MIT](../public/vendor/fflate.LICENSE.md) |
| Unicode文字方向 | [Unicode 17](https://www.unicode.org/Public/17.0.0/ucd/VerticalOrientation.txt) / [Unicode-3.0](../fixtures/unicode/LICENSE.txt) |
| Unicode改行 | [@cto.af/linebreak](https://www.npmjs.com/package/@cto.af/linebreak) / [manifest](../public/vendor/linebreak/manifest.json)・同梱MIT |
| Lucide | [Lucide](https://lucide.dev/) / [ISC](../public/vendor/lucide/LICENSE) |

ロゴは提供された画像の輪郭をSVGにしたものです。画像や外部フォントを実行時に取りに行きません。
