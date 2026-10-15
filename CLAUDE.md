# pixel-learning-rpg

起動中だけ主人公が強くなる暇つぶし系ローグライク＋勉強機能のゲーム。このリポジトリには2つのものがある。

1. **ドット絵ツール**（`pixel/`）：ドット絵を Claude Code がテキストデータとして生成し、40HzP がブラウザのエディタで手直しする。手直しの傾向を Claude Code が読み取って次の生成に反映する。仕様書：`docs/spec.md`
2. **ゲーム本体**（`game/`）：第1段階（試作）。設計書：`docs/game-spec.md`（下の「ゲーム本体」の章）

- 設計ページ（正本）：https://app.notion.com/p/3e9bafd061fe8020af5cd7e51d08c4ab
- 問題リスト（正本）：https://app.notion.com/p/3f0bafd061fe80aa94a6d38dc9a6e41a

## 守ること（ドット絵ツール）

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

---

# ゲーム本体（game/）

設計書は `docs/game-spec.md`。設計ページと食い違うときは設計ページを優先し、食い違いを 40HzP に報告する。ただし CLAUDE.md に 40HzP の依頼として記録した決定は、設計ページより優先する。

## ゲームの決まり

- 40HzP はプログラミングをしない。**継続的な保守やデバッグが要る構成にしない**
- **ビルド工程なし・npm パッケージなし**。素の HTML / CSS / JavaScript（ES モジュール）で書く。テストは Node.js 組み込みのテストランナー（`node --test`）だけ
- 外部への通信をしない（CDN も使わない）。フォントは `game/fonts/`（DotGothic16。SIL Open Font License 1.1。ライセンス文 `OFL.txt` を必ず一緒に置く）
- ドット絵ツールの決まりは変えない
  - `pixel/editor.html` とスプライトJSONの形式（`serializeSprite`）を変更しない
  - ゲームは `pixel/sprites/*.json` と `pixel/palette.json` を **読むだけ**。`_original/` と `export/` は読まない
  - スプライトをゲーム用にコピー・変換して置かない（手直しした瞬間にゲームへ反映されるようにする）
  - ゲームが読むスプライトは `monsters.json`・`recruits.json` の `sprites` に書いた名前、`town.json` の `background` と施設の `sprite`、`stages.json` の `background`、`hero_idle` / `hero_attack` だけ（ブラウザはフォルダの中身を一覧できないため）
- 計算（`sim.js`・`quiz.js`・`save.js`・`genres.js`）はブラウザの機能（DOM・localStorage）に触らない。乱数は `ctx.rng` で渡す（テストで固定するため）
- 対象はスマホのブラウザ（縦画面）とデスクトップ版 Chrome。将来ストアアプリ化するので、ブラウザ固有の機能に頼りすぎない

## フォルダ

```
game/
  index.html             … 入口
  css/style.css
  js/
    main.js              … 起動・画面切り替え・ループ・セーブ（localStorage）
    sim.js               … ゲームの計算（時間・戦闘・階層・睡眠・店・中ボス）
    quiz.js              … 出題・判定・熟練・干渉
    save.js              … セーブの文字列化・読み込み・版の移行
    genres.js            … 29ジャンル
    sprites.js           … スプライトJSONの読み込みと描画
    render.js            … 冒険画面の描画（90×160）
    ui/                  … 画面ごとの表示（adventure / study / facility（街） / zukan / debug / dom / movie（ミニムービー））
  data/
    balance.json         … 数値（ここを書き換えるだけで調整できる）
    monsters.json        … 魔物・小ボス・中ボス
    items.json           … 店の品物
    recruits.json        … 仲間が集まる場所で契約できる仲間
    town.json            … 施設画面の街（背景、施設の外観の名前と置く位置、主人公の立つ位置）
    stages.json          … 10階層ごとの世界（始まる階層・名前・ジャンル・背景）
    questions.json       … 問題（Notion から生成。手で編集しない）
  fonts/                 … DotGothic16 と OFL.txt
  tests/                 … node --test 用
tools/check-questions.mjs … questions.json の検査
.github/workflows/pages.yml … テストを通してから GitHub Pages に公開
```

## 数値の調整

- 数値はすべて `game/data/balance.json` に置いてある。40HzP に「◯◯を△△にして」と頼まれたらここを直す。各項目の意味は設計書8章
- 設計書・設計ページと違う値：`time.gameHoursPerRealSecond` は 58.4（現実の1時間＝ゲーム内の24年）。設計の「現実1時間＝1年」（2.4333）を 40HzP の依頼で24倍速にした。最初の案内の「7歳まで約◯分」はこの値から計算して出す
- 魔物の強さと、次のLvまでの経験値の式は設計書8章と違う（40HzP の「20階層まで上がれない」で変えた）
  - 階層Fの魔物の数値＝ `monster.base` ＋ `monster.perFloor` ×（F−1）。1階層ごとに一定の量ずつ強くなる（設計の `growthPerFloor`・`hpGrowthPerFloor` の掛け算は外した）
  - 次のLvまでの経験値＝ `levelExp.base` × Lv^`levelExp.power`（今は Lv の2乗。設計の growth^(Lv−1) は外した）
  - 理由：主人公はレベルごとに足し算で伸びるので、魔物や必要な経験値を掛け算で増やすと必ず頭打ちになる（前の式では何時間遊んでも17〜19階層で止まった）。式を掛け算に戻さない
  - 目安（計算で再現。仲間を雇い、装備を買う）：勉強なしで20階層 約14分・40階層 約1時間・60階層 約2時間10分。1分に1問正解すると20階層 約11分・40階層 約35分・60階層 約65分
  - `adventure.test.js` で「仲間も勉強もなしで1時間のうちに20階層を越え、30分〜1時間の間も進む」を確かめている。数値を変えてこのテストが落ちたら、頭打ちが戻っている
- 主人公と魔物のステータスの伸び方は3倍にしてある（40HzP の「数字が代わり映えしなくて退屈」で変えた）。`hero.perLevel` の全項目・`hero.wisPerCorrect`・`monster.perFloor` の hp・atk・def を3倍にした（初期値の `base` と、経験値・ゴールドの伸びはそのまま）
  - 進み方（何分で何階層）を変えないために、合わせて次も変えた：すばやさ・運の良さ1あたりの効き目（`stats.agiSpeedPerPoint`・`critChancePerLuck`・`goldBonusPerLuck`）を3分の1、装備（`items.json`）の攻撃・防御を3倍、小学校教師の強さを計算で合わせ直した
  - 伸び方をまた変えるときは、この組を同じ倍率で動かすと進み方が保たれる
- 冒険画面の獲得量は「1か月あたり 経験値・ゴールド」（ゲーム内1か月あたり。直近 `rateWindowSec` 秒の平均から出す。ゴールドは契約料を引く前）。その下の行に「契約料（1か月の合計）」と「手取り（ゴールド−契約料。マイナスなら赤）」を並べる。設計の「秒間獲得経験値・ゴールド」を 40HzP の依頼で変えた
- `quiz.timeLimitSec`（難易度☆1〜☆5の制限時間）は 20・30・40・55・70秒。設計の 10〜60秒から 40HzP の依頼でそれぞれ10秒延ばした
- 中ボスは自動では出ない（設計書4.7の「7歳で出る」を 40HzP の依頼で変えた）。`appearAge` に届くと知らせが一度出て、冒険画面に「◯◯に挑戦する」ボタンが出る。押すと今の敵の群れは退き、中ボスが1体で出る。戦っている間は「逃げる」ボタンが出て、押すと中ボスは退く（報酬なし）。負けたときも逃げたときもボタンがまた出る（`sim.js` の `challengeableMidboss`・`challengeMidboss`・`retreatMidboss`）
- 小学校教師の強さは `monsters.json` の `stats`（hp・atk・def・exp・gold）で、階層によらない。主人公がレベル10くらい（木の剣・布の服）でやっと勝てる強さ（HP500・攻撃42・防御34）。`stats` の無い中ボスは、その階層のザコの数値に `balance.json` の `midboss` の倍率を掛ける
- 中ボスを倒したときのミニムービー：`monsters.json` の `defeatMovie`（文の並び）がある中ボスを倒すと、画面全体が暗転して、主人公とその中ボスが向き合う絵（今の世界の背景を切り抜いたもの）の下に文を1つずつ出す。文字は少しずつ出て、タップで進む（途中でタップすると全部出る）。最後の文のあとタップで暗転して戻る。流れている間はゲームの時間を止め、知らせは終わってから出す（`ui/movie.js`、`main.js` の `startMovie`）。冒険で倒しても勉強の正解で倒しても流れる。小学校教師の2つの文は 40HzP の依頼。デバッグ画面から流し直せる
- `quiz.midbossDamageRatio` 中ボスへの正解のダメージ（最大HPに対する割合。0.1＝10%）。ザコ・小ボスへは `correctDamageRatio`（50%）のまま
- 中ボスの防御は、累計の正解数（`knowledge.totalCorrect`。中ボスが出る前の正解も数える）が `monsters.json` の `unlockCorrect` に届くと崩れる（設計書4.7の「出てから5問正解」を 40HzP の依頼で変えた）。足りていれば出てきた時点で攻撃が効く
- 設計書に無い項目：
  - `floor.spawnDelaySec` 群れを倒してから次の群れが出るまでの秒数。ザコは1階層分（`monstersPerFloor` 体）がまとめて出る
  - `quiz.testQuestions` テストの問題数
  - `midboss.expMultiplier`・`goldMultiplier` 中ボスの経験値・ゴールドの倍率、`ally.hpFromBoss` 仲間になったときのHPの倍率
  - `hero.base`・`hero.perLevel` の `mp`（MP）・`wis`（賢さ）・`agi`（すばやさ）・`luck`（運の良さ）。`hero.wisPerCorrect` 正解1回で増える賢さ
  - `hero.expBonusPerCorrect` 正解1回で上がる経験値の倍率（倍率＝1＋累計の正解数×この値。敵を倒したときの経験値に掛ける。不正解では下がらない）
  - `stats.agiSpeedPerPoint` すばやさ1あたり攻撃が速くなる割合（間隔＝attackIntervalSec÷(1＋すばやさ×この値)）
  - `stats.critChancePerLuck`・`critChanceMax`・`critMultiplier` 運の良さによる会心の一撃、`stats.goldBonusPerLuck` 運の良さ1あたりゴールドが増える割合
  - `spell` 主人公の全体攻撃「ひらめき」：敵が `minTargets` 体以上でMPが `mpCost` 以上あると使う。ダメージ＝賢さ×`power`（防御は効かない）。MPは毎秒 `mpRegenPerSec` 回復し、眠ると全回復
  - `boss` 小ボスの強さ：その階層のザコの数値に `hpMultiplier`・`atkMultiplier`・`defMultiplier`・`expMultiplier`・`goldMultiplier` を掛ける
- 主人公の名前は `hero.name`（8文字まで。最初の案内と施設で決める）
- 品物は `items.json`、魔物は `monsters.json`、契約できる仲間は `recruits.json`

## 仲間が集まる場所（契約）

- 施設画面に最初から出ている。`recruits.json` の仲間（戦士・格闘家・魔法使い・僧侶）と契約できる（40HzP の依頼。設計書の第1段階は仲間の一覧だけだった。設計ページの「ゴールドを消費して仲間を手に入れる」を、ゲーム内の月ごとの契約にした）
- 契約すると最初の1か月分（`monthlyCost`）をその場で払い、以後はゲーム内の1か月（`HOURS_PER_MONTH`＝8760÷12時間）ごとに払う。払えないと契約が切れて去る。解約はいつでもできる（払った分は戻らない）
- 強さは主人公に合わせて伸びる：攻撃＝主人公の攻撃×`atkRatio`。`role` は `attack`（先頭を攻撃）・`all`（敵全体を攻撃）・`heal`（主人公のHPを最大HP×`healRatio` 回復）。`intervalSec` は行動の間隔
- 契約した仲間はセーブの `allies` に `hired: true` と次の支払い日 `paidUntil` を持つ。中ボスだった仲間（契約料なし）と同じ配列
- スプライトは `ally_<id>_idle`（大人の頭身・右向き）。冒険画面では主人公の後ろに最大5人まで並べる

## 施設画面（街）

- 施設画面は「街」。`bg_town`（90×160）の上に施設の外観（`town_<施設>`、32×32、category `building`）を並べ、広場に主人公が立つ。設計ページ「施設画面の表示」の「施設を並べる」を、40HzP の依頼で街の見た目にした
- 並べる位置は `town.json` の `x`・`y`（街の左上からのドット数）。建物の前の道と広場は `bg_town` に描いてあるので、位置を変えるときは背景も合わせる。`town.test.js` が「街の中に収まる・重ならない・スプライトがある」を確かめる
- 建物をタップするとその施設に入る（上に「← 街へ」）。中身があるのは店（`shop`）・仲間が集まる場所（`guild`）・寝床（`home`）。それ以外（会社・ロケット発射場・専攻の付け替え・拠点）は「準備中」と `desc` を出す。中身は `facility.js` の `PANELS`
- 広場の主人公をタップすると、主人公のステータスと名前の変更。街の上の帯に所持金と版を出す
- 寝床（`home`）の見た目はテント（`town_home`）。眠ると冒険は1つ手前の階層（`bedFloor`）の最初に戻り、そのあと睡眠の処理（HP・MPの全回復、ゲーム内10時間、熟練の判定）が起きる。1階層なら1階層の最初から。戦っていた群れや中ボスは退く（`sim.js` の `sleepAtBed`）。設計書4.5の寝床は階層を変えなかったのを、40HzP の依頼で変えた。デバッグ画面の「すぐ眠る」も同じ
- 施設の中にいるときは、知らせを画面の下に出す（上の「← 街へ」を隠さない）
- 施設を足すとき：スプライトを描き（`style-guide.md` 9章）、`town.json` に1件足す。中身を作ったら `PANELS` に足す

## 階層と小ボス

- 階層に上限はない（設計書4.1の「9階層を越えたら9階層を繰り返す」は、40HzP の依頼で外した）。敵は階層ごとに強くなり続ける
- 小ボス（かつての学説）は `monsters.json` に `kind: "boss"` で書く。設計書に無い項目：
  - `floor` 出る階層（設計ページでは10階層ごと）
  - `whyBelieved` なぜ信じられたか、`overturnedBy` 誰がどう覆したか（図鑑で正体と一緒に開く）
- 小ボスのいる階層では小ボスだけが1体で出て、倒すと次の階層へ進む。中ボスが待っているときは中ボスが先
- 一度倒した小ボスは出ない（セーブの `bosses`）。その階層はザコの階層になる。小ボスは仲間にならない
- 小ボスのスプライトは 32×32（`style-guide.md`）。ゲームは幅が16より大きい敵を右寄りに1体で描く
- 小ボスを問題に干渉させるには、Notion の問題の「関連する魔物」に小ボスの名前を書き、誤答1に「当時その学説が信じられた根拠」を入れる（設計ページ「誤答選択肢との関係」）
- 今あるのは10階層のテンドウセツ（天動説）だけ。11階層から先はザコだけが出る

## 10階層ごとの世界（背景）

- `stages.json` の `from`（その世界が始まる階層）ごとに背景が変わる。`sim.js` の `stageFor` が、`from` がその階層以下で一番大きい世界を選ぶ
- 今は100階層まで：はじまりの草原（1〜）・生き物の森（11〜）・平安京（21〜）・錬金術の工房（31〜）・ピラミッドの砂漠（41〜）・火山（51〜）・氷の大地（61〜）・夜の都会（71〜）・海の底（81〜）・天空の神殿（91〜）。101階層から先は天空の神殿のまま
- 設計ページ「10階層ごとに世界観をジャンル単位で切り替える」に合わせ、`genre` に世界のジャンルを書いた（今は表示に使っていない）。月面は「ロケットが無いと行けない」階層なので、ロケット発射場ができるまで作らない
- 背景は `bg_floorNN`（NN はその世界の最初の階層。90×160、`style-guide.md` 6章）。10階層の小ボスは最初の世界（1〜10）の最後にいる
- 新しい世界の最初の階層に入ると「◯階層　◯◯に入った」と知らせる
- 世界が変わるときは0.5秒の暗転を挟む（40HzP の依頼）。前半0.25秒で暗くなり、真っ暗の瞬間に背景を入れ替え、後半0.25秒で明るくなる。暗くなるのは冒険画面のキャンバスだけで、ステータスの表示は暗くならない。ゲームの時間は止めない。小ボスを倒して進んだときのほか、倒れて1階層に戻ったとき・セーブを読み込んだときも同じ。起動した直後は暗転しない。長さは `render.js` の `STAGE_FADE_SEC`（`createStageFade`）
- 世界を足すとき：背景を描き、`stages.json` に1件足す。`stages.test.js` が「1階層から始まる・背景がある・大きさが合う」を確かめる

## 「問題を同期して」と頼まれたとき（`questions.json` は手で編集しない）

1. Notion の問題リストを読む（Notion に接続できるなら直接。できなければ、40HzP に「問題リストを CSV で書き出して `game/data/notion-export/` に置いて」と頼む）
2. `questions.json` を書き出す。Notion のプロパティとの対応：

   | Notion | JSON |
   |---|---|
   | ページID（URL末尾の32文字を 8-4-4-4-12 に区切る） | `id` |
   | ` メインジャンル`（先頭に空白あり） | `genre` |
   | サブジャンル | `subgenres`（空なら `[]`） |
   | 難易度（☆の数） | `difficulty`（1〜5） |
   | 問題 | `question` |
   | ` 解答`（先頭に空白あり） | `answer` |
   | 誤答1・誤答2・誤答3 | `wrong`（**誤答1を必ず先頭**。誤答1が俗説の枠） |
   | 解説 | `explanation` |
   | 関連する魔物 | `monster`（空なら `null`） |

   - 問題・解答・誤答が欠けているページは書き出さない
   - 下の「同期しない問題」に書いたページは書き出さない（Notion にはページが残っている）
   - `generatedAt` に書き出した日時（日本時間）を入れる。インデント2、日本語はエスケープしない
3. `node tools/check-questions.mjs` で検査する
4. 増えた問題・外した問題・警告を 40HzP に短く報告する
- 新しい「関連する魔物」が出てきたら `monsters.json` にも足す（設計ページの魔物系の節から。スプライトが無ければ `null`）
- 同期しない問題（40HzP の依頼でゲームから外した。関連する魔物も `monsters.json` に足さない）
  - `3f9bafd0-61fe-81b5-bc6a-f0824e7dddfd`「他人事」の本来の読みは？（関連する魔物：タニンゴト）
- 外した問題がセーブの過去問復習に残っていても、起動時に `quiz.js` の `forgetMissingQuestions` が外す

## 変更したら必ず実行する

```bash
node --test "game/tests/*.test.js"
node tools/check-questions.mjs
```

（Node 22 では `node --test game/tests/` のようにフォルダを渡すと動かないので、ファイルの並びを渡す）

## 手元で動かす

ES モジュールと `fetch` はファイルを直接開く（`file://`）と動かない。リポジトリの一番上で簡易サーバーを立てる。

```bash
python3 -m http.server 8000
```

→ http://localhost:8000/game/ （デバッグ画面は http://localhost:8000/game/?debug=1 ）。画面の崩れは Playwright（スマホ縦画面の大きさ）でスクリーンショットを撮って確かめる。

## 公開（GitHub Pages）

- `.github/workflows/pages.yml`：どのブランチでもテストと問題の検査を行い、**既定のブランチ**に push したときだけ公開する
- 公開物：`game/` 全部、`pixel/palette.json`、`pixel/sprites/*.json`（`_original/`・`export/`・`editor.html` は入れない）、一番上の `index.html`（`game/` へ移動するだけ）
- 公開の設定（Settings → Pages → Source を「GitHub Actions」）は 40HzP が行う。勝手に変えない
- 既定のブランチの最新のコミットでなければ公開しない（古い実行をやり直しても、新しい版を古い版で上書きしない）
- 公開するとき `index.html` の `app-version` とスクリプト・スタイルの URL（`?v=`）にコミットの番号を入れ、`game/version.json` を書く。ゲームは数分ごとに `version.json` を見て、新しい版があれば「読み込み直す」を出す。施設画面の一番下に今の版が出る
- セーブの形を変えたら `save.js` の `SAVE_VERSION` を上げて移行を足す（40HzP の進み具合を消さないため）。版1→2 は敵1体→群れの移行
