# pixel-art-tool

ゲーム（起動中だけ主人公が強くなる暇つぶし系ローグライク＋勉強機能）用のドット絵を、Claude Code がテキストデータとして生成し、40HzP がブラウザのエディタで手直しする。手直しの傾向を Claude Code が読み取って次の生成に反映する。

- 設計ページ：https://app.notion.com/p/3e9bafd061fe8020af5cd7e51d08c4ab
- 仕様書：`docs/spec.md`

## 守ること

- 40HzP はプログラミングをしない。**継続的な保守やデバッグが要る構成にしない**
- エディタは `pixel/editor.html` の単一ファイル。サーバー・ビルド工程・アカウント・外部ライブラリは使わない
- 画像生成AIは使わない。ドット絵は Claude Code が JSON として直接書く
- 対象ブラウザはデスクトップ版 Chrome（File System Access API でフォルダを読み書きする）

## フォルダ

```
pixel/
  editor.html            … エディタ本体
  palette.json           … 固定パレット（32色、キー 0-9 と a-v、"." は透明）
  style-guide.md         … 描き方の規則。生成のたびに読む。手直しの傾向を追記する
  sprites/               … 正本（スプライトJSON）
  sprites/_original/     … Claude Code が最初に生成した版の控え（比較用。生成時以外は書き換えない）
  export/                … エディタが書き出す PNG
```

## スプライトJSONの形式

エディタと同じ形で書く（エディタは保存時にこの形で書き戻すので、形を揃えておくと差分が手直し分だけになる）。

```json
{
  "name": "hero_idle",
  "category": "character",
  "w": 16,
  "h": 16,
  "fps": 4,
  "frames": [
    [
      "......00........",
      "....00a900......"
    ]
  ],
  "edited": false,
  "note": ""
}
```

- インデントは半角スペース2つ。`frames` の各行は1行ずつ。キーの順番は上のとおり
- 日本語はエスケープしない（`\u` にしない）。ファイル末尾は改行1つ
- `name` はファイル名（拡張子なし）と同じにする
- `category` は `style-guide.md` の表の値（character / midboss / monster / boss / background / icon）

## ドット絵を生成するとき

1. `pixel/style-guide.md` を全部読む。末尾の「手直しの傾向」は本文の規則より優先する
2. 色は `pixel/palette.json` のキーだけを使う
3. 同じ内容を `pixel/sprites/<name>.json` と `pixel/sprites/_original/<name>.json` の両方に書く（`edited: false`、`note: ""`）
4. **`sprites/<name>.json` が `edited: true` のものは上書きしない**（40HzP の手直しが消える）。描き直すときは先に 40HzP に確認する
5. 書いたら下の「検査」を実行する。できれば PNG に描いて目で確認する（Python の Pillow などで拡大して描く。`pixel/` には置かない）

### 検査（行数・幅・パレット外の文字）

```bash
python3 - <<'EOF'
import json, glob
pal = json.load(open('pixel/palette.json'))
keys = {c['key'] for c in pal['colors']} | {'.'}
for p in sorted(glob.glob('pixel/sprites/*.json') + glob.glob('pixel/sprites/_original/*.json')):
    d = json.load(open(p))
    for i, f in enumerate(d['frames']):
        if len(f) != d['h']: print(p, f'frame{i+1}: rows {len(f)} != h {d["h"]}')
        for y, r in enumerate(f):
            if len(r) != d['w']: print(p, f'frame{i+1} row{y}: len {len(r)} != w {d["w"]}')
            bad = set(r) - keys
            if bad: print(p, f'frame{i+1} row{y}: palette外 {bad}')
print('checked')
EOF
```

## 「手直しを反映して」と頼まれたとき

1. `pixel/sprites/*.json` のうち `edited: true` のものを探す
2. `style-guide.md` 末尾の「反映済みの記録」を見て、前回の反映以降に変わったものだけを対象にする
   - 記録にあるスプライトは `git diff <記録のコミット> -- pixel/sprites/<name>.json` で前回からの変化だけを見る
   - 40HzP の手直しがまだコミットされていなければ、先にコミットする（メッセージ例：「40HzP の手直し：hero_idle」）
3. 対象ごとに `_original/` と比べる。下の「差分の表示」を使い、ピクセル単位で何が変わったかを見る
   - 見る観点：輪郭（太さ・色・内側の線）、目の位置と大きさ、頭身と頭部のピクセル数、光源と影の付け方、色の選び方、シルエット、ポーズ、フレームの増減と動き、fps
4. `note` も読む（40HzP の指示）
5. `style-guide.md` の「手直しの傾向」に、決められた書き方で追記する
   - 複数のスプライトに共通する変化は「傾向」として一般化して書く
   - 1体だけの変化は、そのスプライトの好みとして書く（無理に一般化しない）
   - 本文の規則と食い違うときは「（○章の規則を上書き）」と書き添える
6. 「反映済みの記録」の表に、日付・スプライト名・手直しを含むコミットのハッシュを追加する
7. `_original/` は書き換えない。`edited` も `false` に戻さない
8. `note` にスプライト自体の描き直しが要る指示（例：「顔をもっと幼く」）があれば、報告の中で「描き直すか」を 40HzP に確認する（勝手に上書きしない）
9. 40HzP には、読み取った傾向を短く報告する

### 差分の表示

```bash
python3 - hero_idle <<'EOF'
import json, sys
name = sys.argv[1]
a = json.load(open(f'pixel/sprites/_original/{name}.json'))
b = json.load(open(f'pixel/sprites/{name}.json'))
print('note:', b.get('note', ''))
print('fps:', a['fps'], '->', b['fps'], ' frames:', len(a['frames']), '->', len(b['frames']))
for i in range(max(len(a['frames']), len(b['frames']))):
    fa = a['frames'][i] if i < len(a['frames']) else None
    fb = b['frames'][i] if i < len(b['frames']) else None
    print(f'--- frame {i+1}  (元の版 | 今 | 変化 ^)')
    if not fa or not fb:
        print('  元の版にない／削除されたフレーム'); continue
    for y, (ra, rb) in enumerate(zip(fa, fb)):
        mark = ''.join('^' if x != z else ' ' for x, z in zip(ra, rb))
        print(f'{y:3d} {ra} | {rb} | {mark}')
EOF
```

## エディタ（pixel/editor.html）を直すとき

- 単一ファイル・外部ライブラリなし・ビルドなしを保つ
- 保存形式（`serializeSprite` / `serializePalette`）を変えない。変えると全ファイルに差分が出る
- `_original/` には書き込まない（読むだけ）
- 直したら Chrome で動作を確かめる（フォルダを開く → 編集 → 保存 → JSON に反映され `edited: true` → PNG 書き出し → 比較表示）
