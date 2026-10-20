// 勉強画面（設計ページ「勉強画面の表示」）
import { createSession, nextQuestion, answer, presentTest, gradeTest, interferingMonster, blockedInterference, fooledAnalysis, MODES, OOGIRI_MAX_LENGTH, flyerSpan } from '../quiz.js';
import { genreState, midbossState, midbossLeft, expMultiplier, proficiencyCap, ageYears, newspaperActive } from '../sim.js';
import { fieldById, fieldActive } from '../fields.js';
import { GENRES } from '../genres.js';
import { spriteCanvas } from '../sprites.js';
import { el, stars } from './dom.js';
import { teacherForAge } from './tear.js';

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

// phase：menu・question（クイズ・過去問復習の1問）・result・summary・sheet（テストの用紙に答えている）・testResult（テストの採点）
// revealed：「選択肢を表示する」を押したか（押すまで選択肢を出さず、制限時間も減らない。40HzP の依頼）。revealedAt：押した時刻
// picks：テストの問題ごとに選んだ選択肢の番号（'oogiri' は大喜利）。oogiri：大喜利に書いた文
const fresh = () => ({ phase: 'menu', session: null, remaining: 0, revealed: false, revealedAt: 0, result: null, chosen: null, genre: null, interferingId: null, picks: [], oogiri: [], testResults: null, sheetMeta: [] });
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
function renderMenu(app) {
  const k = app.state.knowledge;
  const list = genresWithQuestions(app);
  // ジャンルを変えたらメニューを作り直す（テストの問題数の表示もジャンルで変わる）
  const sel = el('select', { onchange: (e) => { view.genre = e.target.value; renderBody(app); } },
    list.map((x) => el('option', { value: x.genre, selected: x.genre === view.genre }, `${x.genre}（${x.count}問）`)));
  const prof = GENRES.filter((g) => list.some((x) => x.genre === g) || (k.genres[g] && k.genres[g].level > 0));
  const per = app.ctx.balance.quiz.correctPerProficiencyLevel;
  const cap = proficiencyCap(app.state, app.ctx.balance);
  refs.body.replaceChildren(
    el('div', { class: 'modes' },
      el('button', { onclick: () => start(app, 'quiz') }, 'クイズ', el('small', {}, '全ジャンルから1問')),
      el('div', { class: 'row' }, sel,
        el('button', { onclick: () => start(app, 'test', view.genre) }, 'テスト', el('small', {}, `このジャンルから${testCount(app)}問・時間制限なし`))),
      el('button', { disabled: !k.review.length, onclick: () => start(app, 'review') },
        '過去問復習', el('small', {}, k.review.length ? `間違えた問題・騙された問題（${k.review.length}問）` : 'まだありません'))),
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
    a.review.length ? el('div', {}, `間違えたままの問題：${join(a.review, '問')}（過去問復習で解き直せる）`) : null);
}

/** テストの問題数：testQuestions 問（選んだジャンルの問題が足りなければ、ある分だけ） */
function testCount(app) {
  const n = app.ctx.questions.filter((q) => q.genre === view.genre).length;
  return Math.min(app.ctx.balance.quiz.testQuestions, n);
}

function start(app, mode, genre = null) {
  view.session = createSession(app.state, mode, app.ctx, genre);
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
    }, key === 'oogiri' ? '大喜利をする（フリースペース）' : cur.choices[key].text));
    return el('div', { class: 'test-q' }, meta, questionText(app, cur.question), el('div', { class: 'choices' }, buttons, free));
  });
  showLeft();
  refs.body.replaceChildren(
    el('div', { class: 'paper' },
      paperHead(app, s),
      el('div', { class: 'paper-note' }, `全${s.total}問・時間制限なし。答えは提出するまで選び直せる`),
      ...cards),
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
  const summary = [
    ok ? ['good', `経験値の倍率が ×${expMultiplier(app.state, app.ctx.balance).toFixed(2)} になった`] : null,
    ['', g.level < cap ? `${s.genre}：熟練 Lv ${g.level}　次のLvまで ${g.progress}/${per}回` : `${s.genre}：熟練 Lv ${g.level}（最大）`],
  ].filter(Boolean);
  const cards = rs.map((r, i) => el('div', { class: 'test-q' },
    el('div', { class: 'result-mark' }, el('b', {}, r.correct ? '○' : '×'), `${i + 1}問目　${r.correct ? '正解' : r.oogiri ? '大喜利（不正解）' : r.timeout ? '答えていない' : '不正解'}`),
    el('div', { class: 'qtext' }, r.question.question),
    el('div', { class: 'choices' }, r.choices.map((c, j) => el('button', {
      disabled: true,
      class: c.kind === 'answer' ? 'correct' : j === r.chosen ? 'wrong' : '',
    }, c.text))),
    r.oogiri ? el('div', { class: 'oogiri-answer' }, el('span', { class: 'label' }, '大喜利の答え'), r.oogiri) : null,
    el('div', { class: 'explain' }, el('div', { class: 'accent' }, `正解：${r.question.answer}`), r.question.explanation),
    el('ul', { class: 'effects' }, effectLines(app, r, true).map(([cls, t]) => el('li', { class: cls }, t)))));
  const buttons = () => el('div', { class: 'btnrow' },
    el('button', { class: 'primary', onclick: () => start(app, 'test', s.genre) }, 'もう一度'),
    el('button', { onclick: () => { view.phase = 'menu'; view.session = null; renderBody(app); } }, 'メニューへ'));
  // 採点した答案も同じ紙のまま。先生の赤ペンで○×と点数を付ける
  refs.body.replaceChildren(
    el('div', { class: 'paper graded' },
      paperHead(app, s),
      el('div', { class: 'paper-score' }, `${rs.length}問中${ok}問正解`),
      el('ul', { class: 'effects' }, summary.map(([cls, t]) => el('li', { class: cls }, t))),
      ...cards),
    buttons(),
  );
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
    el('div', { class: 'qmeta' }, `${stars(q.difficulty)}　${progress}`, cur.trimmedBy ? el('span', { class: 'good' }, `　${cur.trimmedBy}で誤答が1つ消えた`) : null),
    questionText(app, q),
    el('div', { class: 'timebar', id: 'timebar' }, el('i', { style: { width: ratio * 100 + '%' } })),
    view.revealed
      ? el('div', { class: 'choices' }, cur.choices.map((c, i) => el('button', { onclick: () => pick(app, i) }, c.text)))
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
    if (r.midbossBroken) lines.push(['good', `${r.targetName}の防御が崩れた！`]);
    if (r.targetName && r.damage > 0) lines.push(['good', r.interfered ? `口を挟んでいた${r.targetName}に大ダメージ（${r.damage}）` : `${r.targetName}に${r.damage}ダメージ`]);
    if (r.targetName && r.damage === 0 && r.targetMidboss) {
      const st = midbossState(app.state, r.targetMidboss);
      const mb = app.ctx.monsters.find((m) => m.id === r.targetMidboss);
      if (st.status !== 'broken') lines.push(['', `${r.targetName}には効かない…（防御が崩れるまで 累計であと${midbossLeft(app.state, mb)}問）`]);
    }
    if (r.defeated) lines.push(['good', `${r.targetName}を倒した！`]);
    if (!brief) lines.push(['good', `経験値の倍率が ×${expMultiplier(app.state, app.ctx.balance).toFixed(2)} になった`]);
    if (r.levelUp) lines.push(['good', `${r.levelUp.genre}の熟練が Lv ${r.levelUp.level} になった！`]);
    else if (!brief && g && g.level < proficiencyCap(app.state, app.ctx.balance)) lines.push(['', `${r.question.genre}：次のLvまで ${g.progress}/${per}回`]);
    for (const z of r.zukan) lines.push(['good', `図鑑：${name(z.monsterId)}の正体が判明した`]);
  } else {
    if (r.fooled) lines.push(['bad', `${r.targetName}に騙された！　${r.targetName}が${r.healed}回復した`]);
    lines.push(['', '過去問復習に入った']);
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
    }, c.text))),
    el('div', { class: 'explain' }, el('div', { class: 'accent' }, `正解：${r.question.answer}`), r.question.explanation),
    el('ul', { class: 'effects' }, effectLines(app, r).map(([cls, t]) => el('li', { class: cls }, t))),
    el('div', { class: 'btnrow' }, buttons),
  );
}

function renderSummary(app) {
  const s = view.session;
  const ok = s.results.filter((r) => r.correct).length;
  refs.body.replaceChildren(
    el('div', { class: 'result-head' }, `${MODES[s.mode]}終了：${s.results.length}問中${ok}問正解`),
    el('ul', { class: 'effects' }, s.results.map((r) => el('li', { class: r.correct ? 'good' : 'bad' }, `${r.correct ? '○' : '×'} ${r.question.question}`))),
    el('div', { class: 'btnrow' },
      s.mode !== 'review' || app.state.knowledge.review.length
        ? el('button', { class: 'primary', onclick: () => start(app, s.mode, s.genre) }, 'もう一度')
        : null,
      el('button', { onclick: () => { view.phase = 'menu'; view.session = null; renderBody(app); } }, 'メニューへ')),
  );
}

function renderBody(app) {
  renderInfo(app);
  if (view.phase === 'question') renderQuestion(app);
  else if (view.phase === 'sheet') renderSheet(app);
  else if (view.phase === 'testResult') renderTestResult(app);
  else if (view.phase === 'result') renderResult(app);
  else if (view.phase === 'summary') renderSummary(app);
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
  if (view.phase === 'question') {
    // 干渉中の魔物は、戦っている敵が変わると変わる
    if (interferenceKey(app, view.session.current.question) !== view.interferingId) {
      document.getElementById('interfere').replaceWith(interferenceBanner(app, view.session.current.question));
    }
  }
}
