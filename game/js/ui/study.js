// 勉強画面（設計ページ「勉強画面の表示」）
import { createSession, nextQuestion, answer, interferingMonster, MODES } from '../quiz.js';
import { genreState, midbossState, midbossLeft, expMultiplier, proficiencyCap } from '../sim.js';
import { GENRES } from '../genres.js';
import { spriteCanvas } from '../sprites.js';
import { el, stars } from './dom.js';

const fresh = () => ({ phase: 'menu', session: null, remaining: 0, result: null, chosen: null, genre: null, interferingId: null });
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
  const key = `${genre}|${g.level}|${next}|${cap}`;
  if (refs.info.dataset.key === key) return;
  refs.info.dataset.key = key;
  refs.info.replaceChildren(
    el('div', {}, 'ジャンル ', el('b', {}, genre)),
    el('div', {}, '熟練 ', el('b', {}, `Lv ${g.level}`), ` / ${cap}`),
    el('div', {}, '次のLvまで ', el('b', {}, next)),
    el('div', { class: 'muted' }, '専攻 — ／ —'),
  );
}

/* ---------- メニュー ---------- */
function renderMenu(app) {
  const k = app.state.knowledge;
  const list = genresWithQuestions(app);
  const sel = el('select', { onchange: (e) => { view.genre = e.target.value; renderInfo(app); } },
    list.map((x) => el('option', { value: x.genre, selected: x.genre === view.genre }, `${x.genre}（${x.count}問）`)));
  const prof = GENRES.filter((g) => list.some((x) => x.genre === g) || (k.genres[g] && k.genres[g].level > 0));
  const per = app.ctx.balance.quiz.correctPerProficiencyLevel;
  const cap = proficiencyCap(app.state, app.ctx.balance);
  refs.body.replaceChildren(
    el('div', { class: 'modes' },
      el('button', { onclick: () => start(app, 'quiz') }, 'クイズ', el('small', {}, '全ジャンルから1問')),
      el('div', { class: 'row' }, sel,
        el('button', { onclick: () => start(app, 'test', view.genre) }, 'テスト', el('small', {}, `このジャンルから${app.ctx.balance.quiz.testQuestions}問`))),
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
  );
}

function start(app, mode, genre = null) {
  view.session = createSession(app.state, mode, app.ctx, genre);
  if (genre) view.genre = genre;
  ask(app);
}

/* ---------- 出題中 ---------- */
function ask(app) {
  const cur = nextQuestion(app.state, view.session, app.ctx);
  if (!cur) { view.phase = view.session.results.length ? 'summary' : 'menu'; renderBody(app); return; }
  view.phase = 'question';
  view.remaining = cur.timeLimit;
  view.result = null;
  view.chosen = null;
  view.interferingId = null;
  renderBody(app);
}

function interferenceBanner(app, q) {
  const m = interferingMonster(app.state, q, app.ctx);
  view.interferingId = m ? m.id : null;
  // 干渉が無いときも同じ高さの枠を置く（出たり消えたりしても解答ボタンの位置を変えない）
  if (!m) return el('div', { class: 'interfere off', id: 'interfere', 'aria-hidden': 'true' });
  const sp = (app.monsterSprites[m.id] || {}).idle || null;
  // 枠の高さは変えない（小ボスの 32×32 は等倍で入れる）
  return el('div', { class: 'interfere', id: 'interfere' }, spriteCanvas(sp, sp && sp.h > 16 ? 1 : 2, app.palette), el('span', {}, `${m.name}が口を挟んでいる`));
}

function renderQuestion(app) {
  const s = view.session;
  const cur = s.current;
  const q = cur.question;
  const progress = s.total > 1 ? `${MODES[s.mode]} ${s.index + 1}/${s.total}問目` : MODES[s.mode];
  refs.body.replaceChildren(
    interferenceBanner(app, q),
    el('div', { class: 'qmeta' }, `${stars(q.difficulty)}　${progress}`),
    el('div', { class: 'qtext' }, q.question),
    el('div', { class: 'timebar', id: 'timebar' }, el('i', { style: { width: '100%' } })),
    el('div', { class: 'choices' }, cur.choices.map((c, i) => el('button', { onclick: () => submit(app, i) }, c.text))),
  );
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
function effectLines(app, r) {
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
    lines.push(['good', `経験値の倍率が ×${expMultiplier(app.state, app.ctx.balance).toFixed(2)} になった`]);
    if (r.levelUp) lines.push(['good', `${r.levelUp.genre}の熟練が Lv ${r.levelUp.level} になった！`]);
    else if (g && g.level < proficiencyCap(app.state, app.ctx.balance)) lines.push(['', `${r.question.genre}：次のLvまで ${g.progress}/${per}回`]);
    for (const z of r.zukan) lines.push(['good', `図鑑：${name(z.monsterId)}の正体が判明した`]);
  } else {
    if (r.fooled) lines.push(['bad', `${r.targetName}に騙された！　${r.targetName}が${r.healed}回復した`]);
    lines.push(['', '過去問復習に入った']);
  }
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
  else if (view.phase === 'result') renderResult(app);
  else if (view.phase === 'summary') renderSummary(app);
  else renderMenu(app);
}

/* ---------- 毎フレーム（制限時間） ---------- */
export function frame(app, realDt) {
  if (view.phase !== 'question' || app.tab !== 'study') return; // 勉強画面を見ていない間は止める
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
  if (force) { renderBody(app); return; }
  if (view.phase === 'question') {
    // 干渉中の魔物は、戦っている敵が変わると変わる
    const m = interferingMonster(app.state, view.session.current.question, app.ctx);
    if ((m ? m.id : null) !== view.interferingId) {
      document.getElementById('interfere').replaceWith(interferenceBanner(app, view.session.current.question));
    }
  }
}
