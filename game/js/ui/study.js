// 勉強画面（設計ページ「勉強画面の表示」）
import { createSession, nextQuestion, answer, presentTest, gradeTest, interferingMonster, blockedInterference, fooledAnalysis, MODES, OOGIRI_MAX_LENGTH, flyerSpan, recordTorn, remedialOpen, adoptedQuestions, testShareText, SHARE_HASHTAG, toggleFavorite, isFavorite, reviewLists } from '../quiz.js';
import { genreState, midbossState, midbossLeft, expMultiplier, proficiencyCap, ageYears, newspaperActive, authorRightsInfo } from '../sim.js';
import { fieldById, fieldActive } from '../fields.js';
import { GENRES } from '../genres.js';
import { spriteCanvas, cssColor } from '../sprites.js';
import { el, stars } from './dom.js';
import { teacherForAge } from './tear.js';
import { createDoodle, attachDoodle } from './doodle.js';
import { shareTest } from './share.js';

/** 選択肢の文。学会の査読者（研究室の顧問）が「要出典」の印を付けた俗説には印を出す */
const choiceText = (c) => (c.cited ? [c.text, el('span', { class: 'cite' }, '要出典')] : c.text);
/** 要出典の印を付けたことの一言（問題の上の行） */
const citedNote = (cur) => (cur.citedBy ? el('span', { class: 'good' }, `　${cur.citedBy}が俗説に「要出典」を付けた`) : null);

/** ユーザーの作問から採用した問題なら、解説の下に作問者（ペンネーム）を出す。自分の問題なら、そうと分かるように */
function credit(app, q) {
  if (!q.author) return null;
  const mine = adoptedQuestions(app.state, app.ctx).includes(q);
  return el('div', { class: 'credit' }, q.author.name ? `作問：${q.author.name}` : 'みんなの作問から採用', mine ? el('b', {}, '（あなたが作った問題）') : null);
}

/**
 * 解いている問題の文。月面のボス・ツキジンセツが新聞のビラをまいている間は、一部がビラで隠れる
 * （隠す場所は問題ごとに決まっている。quiz.js の flyerSpan）
 */
function questionText(app, q) {
  if (!newspaperActive(app.state)) return el('div', { class: 'qtext' }, q.question);
  const { start, length } = flyerSpan(q);
  const t = q.question;
  return el('div', {},
    el('div', { class: 'flyer-note' }, '新聞のビラで、問題文の一部が隠れている（ツキジンセツ）'),
    el('div', { class: 'qtext' }, t.slice(0, start), el('span', { class: 'flyer', role: 'img', 'aria-label': '新聞のビラ' }, '　'.repeat(length)), t.slice(start + length)));
}

// phase：menu・question（クイズ・過去問復習で解き直す1問）・result・summary・reviewList（過去問復習：最近解いた問題とお気に入り）・testGenre（テストのジャンルを選ぶ）・sheet（テストの用紙に答えている）・testResult（テストの採点）
// revealed：「選択肢を表示する」を押したか（押すまで選択肢を出さず、制限時間も減らない。40HzP の依頼）。revealedAt：押した時刻
// picks：テストの問題ごとに選んだ選択肢の番号（'oogiri' は大喜利）。oogiri：大喜利に書いた文。doodle：テストの用紙の落書き（ui/doodle.js）
const fresh = () => ({ phase: 'menu', session: null, remaining: 0, revealed: false, revealedAt: 0, result: null, chosen: null, genre: null, interferingId: null, picks: [], oogiri: [], testResults: null, sheetMeta: [], doodle: createDoodle() });
let view = fresh();
let refs = null;

function genresWithQuestions(app) {
  const counts = {};
  for (const q of app.ctx.questions) counts[q.genre] = (counts[q.genre] || 0) + 1;
  return GENRES.filter((g) => counts[g]).map((g) => ({ genre: g, count: counts[g] }));
}

export function init(app) {
  refs = { info: document.getElementById('study-info'), body: document.getElementById('study-body'), mini: document.getElementById('mini') };
  refs.miniCtx = refs.mini.getContext('2d');
  reset(app);
}

export function reset(app) {
  view = fresh();
  const list = genresWithQuestions(app);
  view.genre = list.length ? list[0].genre : GENRES[0];
}

export function drawMini() {
  refs.miniCtx.imageSmoothingEnabled = false;
  refs.miniCtx.clearRect(0, 0, 90, 160);
  refs.miniCtx.drawImage(document.getElementById('scene'), 0, 0);
}

/* ---------- 上部：ジャンル・熟練・専攻 ---------- */
function renderInfo(app) {
  const cur = view.session && (view.session.current || (view.result && view.result.question));
  const genre = cur ? cur.genre || cur.question.genre : view.genre;
  const g = app.state.knowledge.genres[genre] || { level: 0, progress: 0 };
  const per = app.ctx.balance.quiz.correctPerProficiencyLevel;
  const cap = proficiencyCap(app.state, app.ctx.balance); // 生まれ変わるたびに上がる
  const next = g.level >= cap ? '最大' : `${g.progress}/${per}回`;
  // 専攻（学際分野）。休眠しているものは（休眠）
  const majors = app.state.knowledge.majors.map((id) => {
    const f = id && fieldById(app.ctx, id);
    return f ? f.name + (fieldActive(app.state, app.ctx, id) ? '' : '（休眠）') : '—';
  }).join(' ／ ');
  const key = `${genre}|${g.level}|${next}|${cap}|${majors}`;
  if (refs.info.dataset.key === key) return;
  refs.info.dataset.key = key;
  refs.info.replaceChildren(
    el('div', {}, 'ジャンル ', el('b', {}, genre)),
    el('div', {}, '熟練 ', el('b', {}, `Lv ${g.level}`), ` / ${cap}`),
    el('div', {}, '次のLvまで ', el('b', {}, next)),
    el('div', { class: 'muted' }, `専攻 ${majors}`),
  );
}

/* ---------- メニュー ---------- */
/**
 * メニューのボタンの見た目（40HzP の依頼「クイズ・テスト・過去問復習・作問のボタンにもデザインを」）：
 * アイコン（pixel/sprites の menu_*、16×16 を2倍）と、縁取りの色（パレットのキー）。main.js がアイコンを読む
 */
export const MENU_LOOK = {
  quiz: { icon: 'menu_quiz', color: 'e' },         // 早押しボタン・オレンジ
  test: { icon: 'menu_test', color: 'n' },         // 「100」の答案・青
  review: { icon: 'menu_review', color: 'j' },     // 間違いノート（×を○に）・緑
  remedial: { icon: 'menu_remedial', color: 'f' }, // 黒板・山吹
  compose: { icon: 'menu_compose', color: 'r' },   // 「？」の電球・紫
};

/** パレットの色で縁取り、薄く敷く（style に入れる文字列） */
function tint(app, color) {
  const [r, g, b] = app.palette.get(color) || [169, 167, 184];
  return `--tint:rgb(${r},${g},${b});--tint-bg:rgba(${r},${g},${b},.2)`;
}

/** 色とアイコンの付いたボタン（メニュー・テストのジャンル）。sub は小さい字の説明 */
function tintButton(app, { cls, color, sprite, title, sub, ...props }) {
  return el('button', { class: `tint-btn ${cls}`, style: tint(app, color), ...props },
    spriteCanvas(sprite || null, 2, app.palette),
    el('span', { class: 'tint-text' }, el('b', {}, title), el('small', {}, sub)));
}

const menuButton = (app, id, title, sub, props = {}) =>
  tintButton(app, { cls: 'menu-btn', color: MENU_LOOK[id].color, sprite: app.menuSprites[id], title, sub, ...props });

function renderMenu(app) {
  const k = app.state.knowledge;
  const list = genresWithQuestions(app);
  const prof = GENRES.filter((g) => list.some((x) => x.genre === g) || (k.genres[g] && k.genres[g].level > 0));
  const per = app.ctx.balance.quiz.correctPerProficiencyLevel;
  const cap = proficiencyCap(app.state, app.ctx.balance);
  refs.body.replaceChildren(
    el('div', { class: 'modes' },
      menuButton(app, 'quiz', 'クイズ', '全ジャンルから1問', { onclick: () => start(app, 'quiz') }),
      // テスト：押すとジャンルを選ぶ画面（40HzP の依頼「テスト→ジャンル選択の順に」）
      menuButton(app, 'test', 'テスト', `ジャンルを選んで${app.ctx.balance.quiz.testQuestions}問まで・時間制限なし`, { onclick: () => openTestGenre(app) }),
      // 過去問復習：正解・不正解を問わず最近解いた問題と、お気に入りを見返す（40HzP の依頼）
      menuButton(app, 'review', '過去問復習', k.history.length || k.favorites.length
        ? `最近解いた${k.history.length}問・お気に入り${k.favorites.length}/${app.ctx.balance.quiz.favoritesMax}問を見返す`
        : 'まだありません（問題を解くと、ここで見返せる）',
      { disabled: !k.history.length && !k.favorites.length, onclick: () => openReview(app) }),
      // 小学校教師が学校の顧問なら、破りすてたテストの問題を集めた補習
      remedialOpen(app.state, app.ctx)
        ? menuButton(app, 'remedial', '補習', k.torn.length ? `破りすてたテストの問題（${k.torn.length}問）・小学校教師` : '破りすてたテストの問題はない',
          { disabled: !k.torn.length, onclick: () => start(app, 'remedial') })
        : null,
      // 作問：問題を作って送る（Notion のフォーム）。採用された自分の問題もここで見る
      menuButton(app, 'compose', '作問', authorRightsInfo(app.state, app.ctx).granted
        ? `問題を作って送る${adoptedQuestions(app.state, app.ctx).length ? `・採用 ${adoptedQuestions(app.state, app.ctx).length}問` : ''}`
        : `作問権：どれか${app.ctx.balance.authoring.rightsGenres}つのジャンルを Lv${app.ctx.balance.authoring.rightsLevel} に`,
      { onclick: () => { view.phase = 'compose'; renderBody(app); scrollTop(); } })),
    el('div', { class: 'prof-list' },
      el('span', { class: 'head' }, 'ジャンル'), el('span', { class: 'head' }, '熟練'), el('span', { class: 'head' }, '次のLvまで'),
      prof.flatMap((g) => {
        const s = k.genres[g] || { level: 0, progress: 0, studied: false };
        return [
          el('span', {}, g, s.studied ? el('span', { class: 'muted' }, '（解いた）') : ''),
          el('span', {}, `Lv ${s.level}`),
          el('span', {}, s.level >= cap ? '最大' : `${s.progress}/${per}`),
        ];
      })),
    analysisBox(app),
  );
}

/** 心理統計学（学際分野）：どの俗説に騙されやすいか */
function analysisBox(app) {
  const f = fieldById(app.ctx, 'psych_statistics');
  if (!f || !fieldActive(app.state, app.ctx, f.id)) return null;
  const a = fooledAnalysis(app.state, app.ctx);
  const join = (xs, unit) => xs.slice(0, 5).map((x) => `${x.genre} ${x.count}${unit}`).join('・');
  return el('div', { class: 'analysis' },
    el('h3', { class: 'subhead' }, `${f.name}：騙されやすい俗説`),
    a.total
      ? [el('ol', {}, a.myths.slice(0, 5).map((x) => el('li', {}, `${x.monster.name}「${x.monster.myth}」に${x.fooled}回`))),
        el('div', {}, `騙されやすいジャンル：${join(a.genres, '回')}`)]
      : el('div', { class: 'muted' }, 'まだ俗説に騙されたことがない'),
    a.review.length ? el('div', {}, `間違えたままの問題：${join(a.review, '問')}`) : null);
}

/* ---------- テストのジャンルを選ぶ（ジャンルごとに色とアイコンの付いたボタン。40HzP の依頼） ---------- */
function openTestGenre(app) {
  view.phase = 'testGenre';
  view.session = null;
  renderBody(app);
  scrollTop();
}

/**
 * 問題のあるジャンルを、data/genre-groups.json のまとまり（ことば・数学…）ごとに並べる。
 * まとまりの色でボタンを縁取り、ジャンルのアイコン（genre_*、16×16 を2倍）と、テストの問題数・熟練Lvを出す。
 * genre-groups.json に無いジャンル（genres.js に足したばかり）は「そのほか」に入れる
 */
function renderTestGenre(app) {
  const counts = Object.fromEntries(genresWithQuestions(app).map((x) => [x.genre, x.count]));
  const grouped = new Set(app.genreGroups.flatMap((g) => g.genres.map((x) => x.name)));
  const others = Object.keys(counts).filter((g) => !grouped.has(g)).map((name) => ({ name }));
  const groups = [...app.genreGroups, { name: 'そのほか', color: '3', genres: others }]
    .map((g) => ({ ...g, genres: g.genres.filter((x) => counts[x.name]) }))
    .filter((g) => g.genres.length);
  refs.body.replaceChildren(
    el('div', { class: 'genre-head' },
      el('button', { onclick: () => { view.phase = 'menu'; renderBody(app); } }, '← もどる'),
      el('span', {}, 'テストのジャンルを選ぶ')),
    ...groups.map((g) => el('section', { class: 'genre-group' },
      el('h3', { class: 'genre-group-name', style: `color:${cssColor(app.palette, g.color, '#a9a7b8')}` }, g.name),
      el('div', { class: 'genre-grid' }, g.genres.map((x) => genreButton(app, x.name, g.color, counts[x.name]))))),
  );
}

function genreButton(app, genre, color, count) {
  const lv = (app.state.knowledge.genres[genre] || {}).level || 0;
  const n = Math.min(app.ctx.balance.quiz.testQuestions, count);
  return tintButton(app, { cls: 'genre-btn', color, sprite: app.genreSprites[genre], title: genre, sub: `${n}問・熟練Lv${lv}`, onclick: () => start(app, 'test', genre) });
}

function start(app, mode, genre = null, pool = null) {
  view.session = createSession(app.state, mode, app.ctx, genre, pool);
  if (genre) view.genre = genre;
  if (mode === 'test') startTest(app);
  else ask(app);
}

/* ---------- テスト（時間制限なしで、1枚の用紙にまとめて出す。白い紙に黒い字。40HzP の依頼） ---------- */
function startTest(app) {
  const sheet = presentTest(app.state, view.session, app.ctx);
  if (!sheet.length) { view.phase = 'menu'; renderBody(app); return; }
  view.phase = 'sheet';
  view.picks = sheet.map(() => null);
  view.oogiri = sheet.map(() => '');
  view.testResults = null;
  view.doodle = createDoodle();
  renderBody(app);
  scrollTop();
}

const scrollTop = () => { document.getElementById('screen-study').scrollTop = 0; };

/** 用紙の問題ごとの1行（難易度・誤答が消えた・口を挟んでいる魔物）。敵の群れが変わると書き換える（update） */
function refreshSheetMeta(app) {
  for (const m of view.sheetMeta) {
    const q = m.cur.question;
    const im = interferingMonster(app.state, q, app.ctx);
    const b = im ? null : blockedInterference(app.state, q, app.ctx);
    const key = im ? im.id : b ? `blocked:${b.monster.id}` : '';
    if (key === m.key) continue;
    m.key = key;
    m.meta.replaceChildren(`${m.i + 1}問目　${stars(q.difficulty)}`,
      m.cur.trimmedBy ? el('span', { class: 'good' }, `　${m.cur.trimmedBy}で誤答が1つ消えた`) : '',
      im ? el('span', { class: 'meddle' }, `　${im.name}が口を挟んでいる`) : '',
      citedNote(m.cur) || '',
      b ? el('span', { class: 'good' }, `　${b.monster.name}は口を挟めない（${b.field.name}）`) : '');
  }
}

/** まだ答えていない問題の数（大喜利を選んで何も書いていないものも数える） */
const blankCount = () => view.picks.filter((p, i) => p == null || (p === 'oogiri' && !view.oogiri[i].trim())).length;

function renderSheet(app) {
  const s = view.session;
  const left = el('span', { class: 'muted' });
  const showLeft = () => {
    const n = blankCount();
    left.textContent = n ? `まだ答えていない問題：${n}問` : '全部答えた';
  };
  view.sheetMeta = [];
  const cards = s.sheet.map((cur, i) => {
    const meta = el('div', { class: 'qmeta' });
    view.sheetMeta.push({ meta, cur, i, key: null });
    // 4択のほかに「大喜利をする（フリースペース）」（40HzP の依頼）。選ぶと書く欄が出る。不正解として数える
    const keys = [...cur.choices.map((_, j) => j), 'oogiri'];
    const free = el('textarea', {
      class: 'oogiri-text', rows: 2, maxlength: OOGIRI_MAX_LENGTH, placeholder: '大喜利の答えを書く', 'aria-label': `${i + 1}問目の大喜利の答え`,
      hidden: view.picks[i] !== 'oogiri',
      oninput: (e) => { view.oogiri[i] = e.target.value; showLeft(); },
    });
    free.value = view.oogiri[i];
    const buttons = keys.map((key) => el('button', {
      class: (key === 'oogiri' ? 'oogiri ' : '') + (view.picks[i] === key ? 'picked' : ''),
      'aria-pressed': view.picks[i] === key ? 'true' : 'false',
      onclick: () => {
        // 提出するまで選び直せる。押した選択肢だけ印を付ける（画面は作り直さないので、読んでいる位置が動かない）
        view.picks[i] = key;
        buttons.forEach((b, k) => { b.classList.toggle('picked', keys[k] === key); b.setAttribute('aria-pressed', keys[k] === key ? 'true' : 'false'); });
        free.hidden = key !== 'oogiri';
        if (key === 'oogiri') free.focus();
        showLeft();
      },
    }, key === 'oogiri' ? '大喜利をする（フリースペース）' : choiceText(cur.choices[key])));
    // data-doodle：落書きの位置の基準（問題ごと・問題の文・選択肢。採点した答案でも同じ所に残す）
    const text = questionText(app, cur.question);
    text.dataset.doodle = `${i}t`;
    return el('div', { class: 'test-q', 'data-doodle': i }, meta, text, el('div', { class: 'choices', 'data-doodle': `${i}c` }, buttons, free));
  });
  showLeft();
  const paper = el('div', { class: 'paper' },
    paperHead(app, s),
    el('div', { class: 'paper-note' }, `全${s.total}問・時間制限なし。答えは提出するまで選び直せる`),
    ...cards);
  refs.body.replaceChildren(
    doodleBar(paper).bar,
    paper,
    // 「提出する」の下に、同じ大きさで赤い「破りすてる」
    el('div', { class: 'test-submit' }, left, el('button', { class: 'primary', onclick: () => submitTest(app) }, '提出する'),
      el('button', { class: 'danger', onclick: () => tearTest(app) }, '破りすてる')),
  );
  refreshSheetMeta(app);
}

/** 用紙のいちばん上（ジャンル・名前） */
const paperHead = (app, s) => el('div', { class: 'paper-head' },
  el('span', { class: 'paper-title' }, `${s.genre}　テスト`), el('span', { class: 'paper-name' }, `名前　${app.state.hero.name}`));

/**
 * 分からないときは用紙を破りすてる（答えは数えない。確認は出さない）。破れて落ちていき、主人公の年齢の学校の先生が怒る。
 * 「あやまる」で主人公がおじぎをして戻る（ミニモーション。ui/tear.js）。設計ページ「分からないテスト用紙は破けるが、破くと後で先生に怒られる」
 */
function tearTest(app) {
  if (view.phase !== 'sheet') return;
  recordTorn(app.state, view.session); // 破りすてた問題は覚えておく（小学校教師を学校の顧問にすると補習で出る）
  app.save();
  view.phase = 'menu'; // 確認は出さない（40HzP の依頼）
  view.session = null;
  renderBody(app);
  scrollTop();
  app.tearTest(teacherForAge(ageYears(app.state)));
}

function submitTest(app) {
  if (view.phase !== 'sheet') return;
  const blank = blankCount();
  if (blank && !confirm(`まだ答えていない問題が${blank}問あります。提出しますか？（答えていない問題は不正解）`)) return;
  const picks = view.picks.map((p, i) => (p === 'oogiri' ? { oogiri: view.oogiri[i] } : p));
  const results = gradeTest(app.state, view.session, picks, app.ctx);
  view.testResults = results;
  view.doodle.pen = false; // 落書きは採点した答案にも残す（ペンはしまう）
  view.phase = 'testResult'; // 先に変える（問題を解いている最中ではなくなるので、取っておいたミニムービーが出る）
  // 大喜利を書いていたら、先生がひとこと言って主人公が赤面するミニムービー（ほかのミニムービーより先に出す）
  if (results.some((r) => r.oogiri)) app.oogiriTest(teacherForAge(ageYears(app.state)));
  app.handleEvents(results.flatMap((r) => r.events));
  app.save();
  renderBody(app);
  scrollTop();
}

function renderTestResult(app) {
  const s = view.session;
  const rs = view.testResults;
  const ok = rs.filter((r) => r.correct).length;
  const g = app.state.knowledge.genres[s.genre] || { level: 0, progress: 0 };
  const per = app.ctx.balance.quiz.correctPerProficiencyLevel;
  const cap = proficiencyCap(app.state, app.ctx.balance);
  const per0 = s.periodic; // 中学校教師（学校の顧問）の定期テスト：全問正解で熟練の進みが多くなる
  const summary = [
    per0 ? ['good', per0.capped ? `定期テスト（中学校教師）：全問正解！（熟練はもう上限）` : `定期テスト（中学校教師）：全問正解！　熟練の進みが${per0.progress}問分多くなった`] : null,
    per0 && per0.levelUp ? ['good', `${per0.levelUp.genre}の熟練が Lv ${per0.levelUp.level} になった！`] : null,
    ok ? ['good', `経験値の倍率が ×${expMultiplier(app.state, app.ctx.balance).toFixed(2)} になった`] : null,
    ['', g.level < cap ? `${s.genre}：熟練 Lv ${g.level}　次のLvまで ${g.progress}/${per}回` : `${s.genre}：熟練 Lv ${g.level}（最大）`],
  ].filter(Boolean);
  const cards = rs.map((r, i) => el('div', { class: 'test-q', 'data-doodle': i },
    el('div', { class: 'result-mark' }, el('b', {}, r.correct ? '○' : '×'), `${i + 1}問目　${r.correct ? '正解' : r.oogiri ? '大喜利（不正解）' : r.timeout ? '答えていない' : '不正解'}`),
    el('div', { class: 'qtext', 'data-doodle': `${i}t` }, r.question.question),
    el('div', { class: 'choices', 'data-doodle': `${i}c` }, r.choices.map((c, j) => el('button', {
      disabled: true,
      class: c.kind === 'answer' ? 'correct' : j === r.chosen ? 'wrong' : '',
    }, choiceText(c)))),
    r.oogiri ? el('div', { class: 'oogiri-answer' }, el('span', { class: 'label' }, '大喜利の答え'), r.oogiri) : null,
    el('div', { class: 'explain' }, el('div', { class: 'accent' }, `正解：${r.question.answer}`), r.question.explanation, credit(app, r.question)),
    el('div', { class: 'share-hide' }, favButton(app, r.question)),
    // share-hide：ツイートの画像には出さない行（経験値の倍率・熟練レベルなど。40HzP の依頼）
    el('ul', { class: 'effects share-hide' }, effectLines(app, r, true).map(([cls, t]) => el('li', { class: cls }, t)))));
  const buttons = () => el('div', { class: 'btnrow' },
    el('button', { class: 'primary', onclick: () => start(app, 'test', s.genre) }, 'もう一度'),
    el('button', { onclick: () => openTestGenre(app) }, 'ほかのジャンル'),
    el('button', { onclick: () => { view.phase = 'menu'; view.session = null; renderBody(app); } }, 'メニューへ'));
  // 採点した答案も同じ紙のまま。先生の赤ペンで○×と点数を付ける。答えているときの落書きも残り、続けて描ける
  const paper = el('div', { class: 'paper graded' },
    paperHead(app, s),
    el('div', { class: 'paper-score' }, `${rs.length}問中${ok}問正解`),
    el('ul', { class: 'effects share-hide' }, summary.map(([cls, t]) => el('li', { class: cls }, t))),
    ...cards);
  const { pad, bar } = doodleBar(paper);
  // 結果をツイートする（40HzP の依頼）：答案を落書きごと画像にして、共有の画面か X の投稿の画面を開く（ui/share.js）
  const tweet = () => shareTest({
    paper, pad,
    text: testShareText({ name: app.state.hero.name, genre: s.genre, results: rs, url: gameUrl() }),
    filename: `テスト_${s.genre.replace(/[\\/:*?"<>|]/g, '')}.png`,
    footer: `#${SHARE_HASHTAG}`,
  });
  refs.body.replaceChildren(
    bar,
    paper,
    el('button', { class: 'share-btn', onclick: tweet }, '結果をツイートする'),
    buttons(),
  );
}

/** 公開した版のゲームの場所（ツイートに付ける）。手元で動かしているときは付けない */
const gameUrl = () => (location.protocol === 'https:' ? location.origin + location.pathname : null);

/**
 * 用紙に落書きの canvas を重ね、道具（落書きする・1つ戻す・全部消す）の帯を作る。
 * 帯はスクロールしても画面の上に残る。ペンを出している間は用紙に描けて、答えを選ぶ・スクロールするにはペンをしまう
 */
function doodleBar(paper) {
  const d = view.doodle;
  let sync = () => {};
  const pad = attachDoodle(paper, d, () => sync());
  const pen = el('button', { class: 'pen', onclick: () => { pad.setPen(!d.pen); sync(); } });
  const undo = el('button', { onclick: () => pad.undo() }, '1つ戻す');
  const clear = el('button', { onclick: () => { if (confirm('落書きを全部消しますか？')) pad.clear(); } }, '全部消す');
  const hint = el('div', { class: 'doodle-hint' }, 'ペンをしまうと答えを選べる・スクロールできる');
  sync = () => {
    pen.textContent = d.pen ? 'ペンをしまう' : '落書きする';
    pen.classList.toggle('on', d.pen);
    pen.setAttribute('aria-pressed', d.pen ? 'true' : 'false');
    undo.disabled = clear.disabled = !d.strokes.length;
    hint.hidden = !d.pen;
  };
  sync();
  return { pad, bar: el('div', { class: 'doodle-bar' }, el('div', { class: 'doodle-tools' }, pen, undo, clear), hint) };
}

/* ---------- 出題中 ---------- */
function ask(app) {
  const cur = nextQuestion(app.state, view.session, app.ctx);
  if (!cur) { view.phase = view.session.results.length ? 'summary' : 'menu'; renderBody(app); return; }
  view.phase = 'question';
  view.remaining = cur.timeLimit;
  view.revealed = false;
  view.result = null;
  view.chosen = null;
  view.interferingId = null;
  renderBody(app);
}

/** 干渉の枠の中身が変わったかを見る印（口を挟んでいる魔物か、学際分野で封じた魔物） */
function interferenceKey(app, q) {
  const m = interferingMonster(app.state, q, app.ctx);
  if (m) return m.id;
  const b = blockedInterference(app.state, q, app.ctx);
  return b ? `blocked:${b.monster.id}` : null;
}

function interferenceBanner(app, q) {
  const m = interferingMonster(app.state, q, app.ctx);
  const b = m ? null : blockedInterference(app.state, q, app.ctx);
  view.interferingId = interferenceKey(app, q);
  // 干渉が無いときも同じ高さの枠を置く（出たり消えたりしても解答ボタンの位置を変えない）
  if (!m && !b) return el('div', { class: 'interfere off', id: 'interfere', 'aria-hidden': 'true' });
  const who = m || b.monster;
  const sp = (app.monsterSprites[who.id] || {}).idle || null;
  // 枠の高さは変えない（ボスの 32×32 は等倍で入れる）
  return el('div', { class: 'interfere' + (b ? ' blocked' : ''), id: 'interfere' }, spriteCanvas(sp, sp && sp.h > 16 ? 1 : 2, app.palette),
    b ? el('span', {}, el('span', { class: 'line' }, `${who.name}は口を挟めない`), el('small', { class: 'line' }, `${b.field.name}で封じている`))
      : el('span', {}, `${who.name}が口を挟んでいる`));
}

/**
 * 1問出す。はじめは問題文だけを出し、読み終わって「選択肢を表示する」を押すと、選択肢が出て制限時間が減り始める（40HzP の依頼）。
 * 押したボタンの場所に選択肢が出るので、続けて2回押しても選択肢を押したことにならないように、出てすぐの短い間は選べない（REVEAL_GUARD_MS）
 */
function renderQuestion(app) {
  const s = view.session;
  const cur = s.current;
  const q = cur.question;
  const progress = s.total > 1 ? `${MODES[s.mode]} ${s.index + 1}/${s.total}問目` : MODES[s.mode];
  const ratio = Math.max(0, view.remaining / cur.timeLimit);
  refs.body.replaceChildren(
    interferenceBanner(app, q),
    el('div', { class: 'qmeta' }, `${stars(q.difficulty)}　${progress}`, cur.trimmedBy ? el('span', { class: 'good' }, `　${cur.trimmedBy}で誤答が1つ消えた`) : null, citedNote(cur)),
    questionText(app, q),
    el('div', { class: 'timebar', id: 'timebar' }, el('i', { style: { width: ratio * 100 + '%' } })),
    view.revealed
      ? el('div', { class: 'choices' }, cur.choices.map((c, i) => el('button', { onclick: () => pick(app, i) }, choiceText(c))))
      : el('div', { class: 'reveal' },
        el('button', { class: 'primary', onclick: () => reveal(app) }, '選択肢を表示する'),
        el('div', { class: 'muted' }, `押すと制限時間（${cur.timeLimit}秒）が始まる`)),
  );
}

const REVEAL_GUARD_MS = 300;
function reveal(app) {
  if (view.phase !== 'question' || view.revealed) return;
  view.revealed = true;
  view.revealedAt = performance.now();
  renderQuestion(app);
}
function pick(app, index) {
  if (performance.now() - view.revealedAt < REVEAL_GUARD_MS) return;
  submit(app, index);
}

function submit(app, index) {
  if (view.phase !== 'question') return;
  const s = view.session;
  const cur = s.current;
  const res = answer(app.state, s, index, app.ctx);
  res.question = cur.question;
  res.choices = cur.choices;
  view.result = res;
  view.chosen = index;
  view.phase = 'result';
  app.handleEvents(res.events);
  app.save();
  renderBody(app);
}

/* ---------- 解答後 ---------- */
/** 答えたあとに起きたこと。brief なら、経験値の倍率と熟練の進み具合は出さない（テストはまとめて上に出す） */
function effectLines(app, r, brief = false) {
  const lines = [];
  const name = (id) => (app.ctx.monsters.find((m) => m.id === id) || {}).name || '';
  const g = app.state.knowledge.genres[r.question.genre];
  const per = app.ctx.balance.quiz.correctPerProficiencyLevel;
  if (r.correct) {
    // 正解しても敵にダメージは入らない（40HzP の依頼）。戦っている中ボスの防御が崩れるまでの問題数は出す
    if (r.midbossBroken) lines.push(['good', `${r.targetName}の防御が崩れた！`]);
    else if (r.targetMidboss && midbossState(app.state, r.targetMidboss).status !== 'broken') {
      const mb = app.ctx.monsters.find((m) => m.id === r.targetMidboss);
      lines.push(['', `${r.targetName}の防御が崩れるまで 累計であと${midbossLeft(app.state, mb)}問`]);
    }
    if (!brief) lines.push(['good', `経験値の倍率が ×${expMultiplier(app.state, app.ctx.balance).toFixed(2)} になった`]);
    if (r.levelUp) lines.push(['good', `${r.levelUp.genre}の熟練が Lv ${r.levelUp.level} になった！`]);
    else if (!brief && g && g.level < proficiencyCap(app.state, app.ctx.balance)) lines.push(['', `${r.question.genre}：次のLvまで ${g.progress}/${per}回`]);
    for (const z of r.zukan) lines.push(['good', `図鑑：${name(z.monsterId)}の正体が判明した`]);
    if (r.untorn && remedialOpen(app.state, app.ctx)) lines.push(['good', '破りすてた問題に正解した（補習から外れた）']);
  } else {
    if (r.fooled) lines.push(['bad', `${r.targetName}に騙された！　${r.targetName}が${r.healed}回復した`]);
  }
  if (r.blocked) lines.push(['good', `${r.blocked.field}で、${r.blocked.name}の口出しを封じていた`]);
  return lines;
}
function renderResult(app) {
  const r = view.result;
  const s = view.session;
  const head = r.correct ? ['good', '正解！'] : r.timeout ? ['bad', '時間切れ…'] : ['bad', '不正解…'];
  const last = s.index >= s.total;
  const buttons = [];
  if (!last) buttons.push(el('button', { class: 'primary', onclick: () => ask(app) }, '次の問題へ'));
  else if (s.mode === 'quiz') buttons.push(el('button', { class: 'primary', onclick: () => start(app, 'quiz') }, 'もう1問'));
  else buttons.push(el('button', { class: 'primary', onclick: () => { view.phase = 'summary'; renderBody(app); } }, '結果を見る'));
  buttons.push(el('button', { onclick: () => { view.phase = 'menu'; view.session = null; renderBody(app); } }, 'メニューへ'));
  refs.body.replaceChildren(
    el('div', { class: 'result-head ' + head[0] }, head[1]),
    el('div', { class: 'qtext' }, r.question.question),
    el('div', { class: 'choices' }, r.choices.map((c, i) => el('button', {
      disabled: true,
      class: c.kind === 'answer' ? 'correct' : i === view.chosen ? 'wrong' : '',
    }, choiceText(c)))),
    el('div', { class: 'explain' }, el('div', { class: 'accent' }, `正解：${r.question.answer}`), r.question.explanation, credit(app, r.question)),
    favButton(app, r.question),
    el('ul', { class: 'effects' }, effectLines(app, r).map(([cls, t]) => el('li', { class: cls }, t))),
    el('div', { class: 'btnrow' }, buttons),
  );
}

/* ---------- 過去問復習（正解・不正解を問わず最近解いた10問と、お気に入り5問を見返す。40HzP の依頼） ---------- */
/**
 * お気に入りに入れる・外すボタン。押すと字が変わる。いっぱいのときは知らせを出して入れない。
 * after は押したあとに呼ぶ（過去問復習の一覧を作り直すときなど）
 */
function favButton(app, q, after = null) {
  const b = el('button', { class: 'fav-btn', onclick: () => {
    const r = toggleFavorite(app.state, q.id, app.ctx);
    if (!r.ok) { app.notify(r.reason, 'bad'); return; }
    app.save();
    paint();
    if (after) after();
  } });
  const paint = () => {
    const on = isFavorite(app.state, q.id);
    b.textContent = on ? '★ お気に入り（押すと外す）' : '☆ お気に入りに入れる';
    b.classList.toggle('on', on);
  };
  paint();
  return b;
}

function openReview(app) {
  view.phase = 'reviewList';
  view.session = null;
  view.reviewOpen = view.reviewOpen || new Set();
  renderBody(app);
  scrollTop();
}

/** ジャンルの小さな札（テストのジャンルのボタンと同じ、まとまりの色） */
function genreTag(app, genre) {
  const g = app.genreGroups.find((x) => x.genres.some((y) => y.name === genre));
  return el('span', { class: 'genre-tag', style: tint(app, g ? g.color : '3') }, genre);
}

/**
 * 1問分の札。閉じているときは問題文を2行まで。開くと問題文を全部と、自分の答え（最近解いた問題だけ）・正解と解説・お気に入りのボタン。
 * 開いているかは view.reviewOpen に覚えておく（お気に入りを押して作り直しても、開いたまま）
 */
function reviewCard(app, key, q, h) {
  const fav = isFavorite(app.state, q.id);
  const mark = h ? el('b', { class: h.correct ? 'good' : 'bad' }, h.correct ? '○' : '×') : el('b', { class: 'fav-mark' }, '★');
  const yours = !h ? null
    : h.oogiri ? el('div', { class: 'review-yours' }, '大喜利：', h.oogiri, el('span', { class: 'bad' }, '（不正解）'))
    : h.chosen == null ? el('div', { class: 'review-yours bad' }, '時間切れ・答えていない')
    : el('div', { class: 'review-yours' }, 'あなたの答え：', h.chosen, el('span', { class: h.correct ? 'good' : 'bad' }, h.correct ? '（正解）' : '（不正解）'));
  const d = el('details', { class: 'review-item', open: view.reviewOpen.has(key), ontoggle: () => { if (d.open) view.reviewOpen.add(key); else view.reviewOpen.delete(key); } },
    el('summary', {}, mark, genreTag(app, q.genre), el('span', { class: 'review-q' }, q.question), h && fav ? el('span', { class: 'fav-mark' }, '★') : null),
    el('div', { class: 'review-body' },
      yours,
      el('div', { class: 'explain' }, el('div', { class: 'accent' }, `正解：${q.answer}`), q.explanation, credit(app, q)),
      favButton(app, q, () => renderBody(app))));
  return d;
}

function renderReviewList(app) {
  const { recent, favorites } = reviewLists(app.state, app.ctx);
  const max = app.ctx.balance.quiz.favoritesMax;
  const redo = (ids, label) => (ids.length
    ? el('button', { class: 'primary', onclick: () => start(app, 'review', null, ids) }, `${label}（${ids.length}問）`) : null);
  refs.body.replaceChildren(
    el('div', { class: 'genre-head' },
      el('button', { onclick: () => { view.phase = 'menu'; renderBody(app); } }, '← もどる'),
      el('span', {}, '過去問復習')),
    el('section', { class: 'review-section' },
      el('div', { class: 'review-head' }, el('h3', { class: 'subhead' }, `最近解いた${recent.length}問`),
        redo(recent.map((h) => h.question.id), '解き直す')),
      el('div', { class: 'muted review-note' }, `正解でも不正解でも、新しい順に${app.ctx.balance.quiz.historySize}問まで残る`),
      recent.length
        ? recent.map((h) => reviewCard(app, `r:${h.question.id}`, h.question, h))
        : el('div', { class: 'muted' }, 'まだ解いた問題がない')),
    el('section', { class: 'review-section' },
      el('div', { class: 'review-head' }, el('h3', { class: 'subhead' }, `お気に入り ${favorites.length}/${max}問`),
        redo(favorites.map((q) => q.id), '解き直す')),
      favorites.length
        ? favorites.map((q) => reviewCard(app, `f:${q.id}`, q, null))
        : el('div', { class: 'muted' }, `問題の「☆ お気に入りに入れる」を押すと、ここに入る（${max}問まで）`)),
  );
}

function renderSummary(app) {
  const s = view.session;
  const ok = s.results.filter((r) => r.correct).length;
  refs.body.replaceChildren(
    el('div', { class: 'result-head' }, `${MODES[s.mode]}終了：${s.results.length}問中${ok}問正解`),
    el('ul', { class: 'effects' }, s.results.map((r) => el('li', { class: r.correct ? 'good' : 'bad' }, `${r.correct ? '○' : '×'} ${r.question.question}`))),
    el('div', { class: 'btnrow' },
      s.mode !== 'remedial' || app.state.knowledge.torn.length
        ? el('button', { class: 'primary', onclick: () => start(app, s.mode, s.genre, s.pool) }, 'もう一度')
        : null,
      s.mode === 'review' ? el('button', { onclick: () => openReview(app) }, '過去問復習へ') : null,
      el('button', { onclick: () => { view.phase = 'menu'; view.session = null; renderBody(app); } }, 'メニューへ')),
  );
}

/* ---------- 作問（問題を作って送る。40HzP の依頼） ---------- */
/**
 * 作問：Notion の「作問の受付」のフォーム（data/submit.json の formUrl）を開いて問題を送る。ゲームは通信しない（ブラウザで別のページを開くだけ）。
 * フォームに作問者コードを書いてもらい、採用された問題（questions.json の author.code が同じもの）をここに並べる。
 * 作問権（どれか2つのジャンルを Lv5）が無いうちは、フォームを開けず、作問権までの進み具合だけを出す
 */
/** 作問の画面を作り直す目印（作問権をもらった・作問できるジャンルが増えた） */
const composeKey = (app) => app.state.knowledge.authorGenres.join(',');

function renderCompose(app) {
  view.composeKey = composeKey(app);
  const code = app.state.legacy.author.code;
  const sub = app.submit || {};
  const adopted = adoptedQuestions(app.state, app.ctx);
  const rights = authorRightsInfo(app.state, app.ctx);
  const back = el('div', { class: 'btnrow' }, el('button', { onclick: () => { view.phase = 'menu'; renderBody(app); } }, 'メニューへ'));
  const adoptedList = [
    el('h3', { class: 'subhead' }, `採用されたあなたの問題（${adopted.length}問）`),
    adopted.length
      ? el('div', { class: 'list' }, adopted.map((q) => el('div', { class: 'item' },
        el('div', { class: 'name' }, q.question, el('small', {}, `${q.genre}　${stars(q.difficulty)}　正解：${q.answer}`)))))
      : el('div', { class: 'muted' }, 'まだありません'),
  ];
  if (!rights.granted) {
    refs.body.replaceChildren(
      el('div', { class: 'compose' },
        el('h3', { class: 'subhead' }, '作問（問題を作って送る）'),
        el('p', {}, `自分で作った問題を送るには「作問権」が要ります。どれか${rights.need}つのジャンルの熟練を Lv${rights.level} にすると、そのジャンルの問題を作って送れるようになります（腕のある人の問題だけが届くように）。`),
        el('div', { class: 'author-code' }, `熟練 Lv${rights.level} のジャンル `, el('b', {}, `${rights.reached}/${rights.need}`)),
        rights.top.length
          ? el('p', { class: 'muted' }, `熟練の高いジャンル：${rights.top.map((x) => `${x.genre} Lv${x.level}`).join('・')}`)
          : el('p', { class: 'muted' }, 'まだ熟練の上がったジャンルがない。テストで1つのジャンルを続けて解くと上がりやすい'),
        el('div', { class: 'btnrow' }, el('button', { disabled: true }, '作問権がまだ無い')),
        ...(adopted.length ? adoptedList : []),
        back),
    );
    return;
  }
  const copy = () => {
    try { navigator.clipboard.writeText(code).then(() => app.notify(`作問者コード ${code} をコピーした`), () => {}); } catch (e) { /* コピーできない環境では手で写す */ }
  };
  const open = sub.formUrl
    ? el('button', { class: 'primary', onclick: () => { copy(); window.open(sub.formUrl, '_blank', 'noopener'); } }, 'コードをコピーして作問フォームを開く')
    : el('button', { disabled: true }, '作問フォームは準備中');
  refs.body.replaceChildren(
    el('div', { class: 'compose' },
      el('h3', { class: 'subhead' }, '作問（問題を作って送る）'),
      el('p', {}, '自分で作った問題を送れます。チェックして採用された問題は、ゲームに入ります（手直しして使うことがあります。採用されないこともあります）。'),
      el('div', { class: 'rights' }, el('b', {}, '作問権'), `：${rights.genres.join('・')}（フォームの「メインジャンル」は、このどれかにしてください）`),
      el('div', { class: 'author-code' }, '作問者コード ', el('b', {}, code), el('button', { onclick: copy }, 'コピー')),
      el('p', { class: 'muted' }, 'フォームの「作問者コード」にこのコードを書くと、採用されたときにゲームで知らせます。「ペンネーム」を書くと、問題の解説に「作問：ペンネーム」と出ます。本名や連絡先は書かないでください。'),
      el('div', { class: 'compose-fields' },
        el('div', {}, el('b', {}, '必ず書くこと：'), (sub.required || []).join('・')),
        el('div', {}, el('b', {}, '書かなくてもよいこと：'), (sub.optional || []).join('・'))),
      el('div', { class: 'btnrow' }, open),
      ...adoptedList,
      back),
  );
}

function renderBody(app) {
  renderInfo(app);
  if (view.phase === 'question') renderQuestion(app);
  else if (view.phase === 'testGenre') renderTestGenre(app);
  else if (view.phase === 'reviewList') renderReviewList(app);
  else if (view.phase === 'sheet') renderSheet(app);
  else if (view.phase === 'testResult') renderTestResult(app);
  else if (view.phase === 'result') renderResult(app);
  else if (view.phase === 'summary') renderSummary(app);
  else if (view.phase === 'compose') renderCompose(app);
  else renderMenu(app);
}

/**
 * 問題を解いている最中か（勉強画面に問題が出ていて、まだ答えていない）。
 * この間はミニムービーを出さず、答え終わってから出す（main.js の afterAnswering。40HzP の依頼）
 */
export const answering = (app) => (view.phase === 'question' || view.phase === 'sheet') && app.tab === 'study';

/* ---------- 毎フレーム（制限時間） ---------- */
export function frame(app, realDt) {
  // 勉強画面を見ていない間と、「選択肢を表示する」を押すまでは止める
  if (view.phase !== 'question' || !view.revealed || app.tab !== 'study') return;
  view.remaining -= realDt;
  const bar = document.getElementById('timebar');
  if (bar) {
    const ratio = Math.max(0, view.remaining / view.session.current.timeLimit);
    bar.firstChild.style.width = ratio * 100 + '%';
    bar.classList.toggle('low', ratio < 0.3);
  }
  if (view.remaining <= 0) submit(app, null);
}

export function update(app, force) {
  renderInfo(app);
  if (force) {
    // テストの用紙は作り直さない（選んだ答えと読んでいる位置を保つ）
    if (view.phase === 'sheet') refreshSheetMeta(app);
    else renderBody(app);
    return;
  }
  if (view.phase === 'sheet') refreshSheetMeta(app);
  if (view.phase === 'compose' && composeKey(app) !== view.composeKey) renderBody(app);
  if (view.phase === 'question') {
    // 干渉中の魔物は、戦っている敵が変わると変わる
    if (interferenceKey(app, view.session.current.question) !== view.interferingId) {
      document.getElementById('interfere').replaceWith(interferenceBanner(app, view.session.current.question));
    }
  }
}
