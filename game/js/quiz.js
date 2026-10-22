// 出題・判定・熟練（描画しない・ブラウザの機能に触らない）。
// ctx = { balance, monsters, items, questions, rng }（questions は questions.json の questions 配列）

import { GENRES } from './genres.js';
import { genreState, raiseZukan, zukanEntry, breakMidbosses, damageEnemy, healEnemy, proficiencyCap, markSmooth, advisorActive, citationsLeft } from './sim.js';
import { fieldActive, fieldById } from './fields.js';

export { GENRES };

export const MODES = { quiz: 'クイズ', test: 'テスト', review: '過去問復習', remedial: '補習' };

/**
 * セーブに残っている、もう無い問題（同期で外した問題など）を、過去問復習・補習・直近の出題から外す。
 * 残したままだと「過去問復習」が押せるのに1問も出ない。過去問復習から外した数を返す
 */
export function forgetMissingQuestions(state, ctx) {
  const ids = new Set(ctx.questions.map((q) => q.id));
  const k = state.knowledge;
  const before = k.review.length;
  k.review = k.review.filter((id) => ids.has(id));
  k.torn = (k.torn || []).filter((id) => ids.has(id));
  k.recent = k.recent.filter((id) => ids.has(id));
  return before - k.review.length;
}

/* ================= 出題の選び方 ================= */

/** 熟練Lvに応じた割合で難易度（1〜5）を選ぶ */
export function pickDifficulty(level, balance, rng) {
  const table = balance.quiz.difficultyMixByLevel;
  const mix = table[Math.max(0, Math.min(table.length - 1, level))];
  const total = mix.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < mix.length; i++) {
    r -= mix[i];
    if (r < 0 && mix[i] > 0) return i + 1;
  }
  for (let i = mix.length - 1; i >= 0; i--) if (mix[i] > 0) return i + 1;
  return 1;
}

/** クイズで使う熟練Lv：全ジャンルの熟練の平均を四捨五入 */
export function averageLevel(state) {
  const sum = GENRES.reduce((s, g) => s + (state.knowledge.genres[g] ? state.knowledge.genres[g].level : 0), 0);
  return Math.round(sum / GENRES.length);
}

/**
 * 候補から1問選ぶ。直近の問題（avoid）は避けるが、候補が無くなったら重複を許す。
 * 選んだ難易度の問題が無ければ、近い難易度から選ぶ（同じ近さなら易しいほう）。
 */
export function pickQuestion(candidates, level, avoid, ctx) {
  if (!candidates.length) return null;
  const fresh = candidates.filter((q) => !avoid.includes(q.id));
  const pool = fresh.length ? fresh : candidates;
  const want = pickDifficulty(level, ctx.balance, ctx.rng);
  let best = null;
  for (const q of pool) {
    const d = Math.abs(q.difficulty - want);
    if (best == null || d < best.d || (d === best.d && q.difficulty < best.diff)) best = { d, diff: q.difficulty };
  }
  const same = pool.filter((q) => q.difficulty === best.diff);
  return same[Math.floor(ctx.rng() * same.length)];
}

/** 解答＋誤答を無作為に並べる。誤答1（wrong[0]）は俗説の枠 */
export function buildChoices(q, rng) {
  const choices = [{ text: q.answer, kind: 'answer' }];
  q.wrong.forEach((w, i) => { if (w) choices.push({ text: w, kind: i === 0 ? 'myth' : 'wrong' }); });
  for (let i = choices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return choices;
}

export const timeLimitFor = (difficulty, balance) => balance.quiz.timeLimitSec[Math.max(1, Math.min(5, difficulty)) - 1];

/* ================= 1回分の勉強（セッション） ================= */

/**
 * mode: 'quiz'（全ジャンルから1問）| 'test'（genre から testQuestions 問を1枚の用紙で。presentTest・gradeTest）|
 * 'review'（過去問復習、最大 testQuestions 問）| 'remedial'（補習：破りすてたテストの問題、最大 testQuestions 問。小学校教師が学校の顧問のとき）
 */
export function createSession(state, mode, ctx, genre = null) {
  let total = 1;
  if (mode === 'test') total = ctx.balance.quiz.testQuestions;
  if (mode === 'review') total = Math.min(ctx.balance.quiz.testQuestions, state.knowledge.review.length);
  if (mode === 'remedial') total = Math.min(ctx.balance.quiz.testQuestions, state.knowledge.torn.length);
  return { mode, genre, total, index: 0, asked: [], current: null, results: [] };
}

export function candidatesFor(state, session, ctx) {
  if (session.mode === 'test') return ctx.questions.filter((q) => q.genre === session.genre);
  if (session.mode === 'review') return ctx.questions.filter((q) => state.knowledge.review.includes(q.id));
  if (session.mode === 'remedial') return ctx.questions.filter((q) => state.knowledge.torn.includes(q.id));
  return ctx.questions;
}

/** 補習が使えるか：小学校教師を学校の顧問に置いている（破りすてた問題が無ければ、押しても出ない） */
export const remedialOpen = (state, ctx) => advisorActive(state, ctx, 'teacher_elementary');

/** テストの用紙を破りすてた：用紙の問題を「破りすてた問題」に入れる（小学校教師の補習で出す）。入れた数を返す */
export function recordTorn(state, session) {
  const torn = state.knowledge.torn;
  let n = 0;
  for (const cur of session.sheet || []) if (!torn.includes(cur.question.id)) { torn.push(cur.question.id); n++; }
  return n;
}

/** 次の問題を出す。出せなければ null（セッション終了） */
export function nextQuestion(state, session, ctx) {
  if (session.index >= session.total) { session.current = null; return null; }
  const cands = candidatesFor(state, session, ctx);
  const level = session.mode === 'test' ? genreState(state, session.genre).level : averageLevel(state);
  const avoid = [...state.knowledge.recent, ...session.asked];
  const q = pickQuestion(cands, level, avoid, ctx);
  if (!q) { session.current = null; return null; }
  const cur = presentQuestion(session, q, ctx);
  trimChoices(state, cur, ctx);
  citeMyth(state, cur, ctx);
  return cur;
}

/**
 * テスト：指定ジャンルから testQuestions 問を1枚の用紙にまとめて出す（時間制限なし。40HzP の依頼）。
 * 同じ問題は1枚に1回だけ（ジャンルの問題が足りなければ、ある分だけ出す）。直近に出した問題はなるべく避ける。
 * 出した問題（{ question, choices }）の並びを session.sheet に入れて返す。採点は gradeTest
 */
export function presentTest(state, session, ctx) {
  const level = genreState(state, session.genre).level;
  const sheet = [];
  while (sheet.length < session.total) {
    const cands = candidatesFor(state, session, ctx).filter((q) => !session.asked.includes(q.id));
    const q = pickQuestion(cands, level, state.knowledge.recent, ctx);
    if (!q) break;
    const cur = presentQuestion(session, q, ctx);
    trimChoices(state, cur, ctx);
    citeMyth(state, cur, ctx);
    sheet.push(cur);
  }
  session.current = null;
  session.sheet = sheet;
  session.total = sheet.length;
  return sheet;
}

/** 大喜利（テストのフリースペース）に書ける字数 */
export const OOGIRI_MAX_LENGTH = 60;

/**
 * テストを提出して採点する。picks[i] は i 問目で選んだ選択肢の番号（null は答えていない＝不正解）か、
 * 大喜利の答え { oogiri: '書いた文' }（40HzP の依頼。選択肢のほかに自由に書ける。不正解として数え、騙されたことにはしない。何も書いていなければ答えていない）。
 * 1問ずつ answer と同じに数える（熟練・累計正解数・過去問復習・干渉・敵へのダメージ）。干渉は提出した瞬間の敵の群れで決まる。
 * 結果の並びを返す（answer の結果に question・choices・chosen を付け、大喜利なら oogiri に書いた文を入れる）。
 * 中学校教師を学校の顧問に置いていて全問正解すると、定期テストとして熟練の進みが balance.advisor.periodicTestProgress 問分多くなる
 * （session.periodic に { genre, progress, levelUp }）
 */
export function gradeTest(state, session, picks, ctx) {
  const results = session.sheet.map((cur, i) => {
    session.current = cur;
    const pick = picks[i] ?? null;
    const oogiri = pick && typeof pick === 'object' ? String(pick.oogiri ?? '').trim().slice(0, OOGIRI_MAX_LENGTH) : '';
    const chosen = typeof pick === 'number' ? pick : null;
    const r = answer(state, session, chosen, ctx);
    if (oogiri) Object.assign(r, { timeout: false, oogiri });
    return Object.assign(r, { question: cur.question, choices: cur.choices, chosen });
  });
  session.periodic = null;
  if (results.length && results.every((r) => r.correct) && advisorActive(state, ctx, 'teacher_junior')) {
    const n = ctx.balance.advisor.periodicTestProgress;
    const g = genreState(state, session.genre);
    let levelUp = null;
    for (let i = 0; i < n; i++) levelUp = addProgress(state, session.genre, ctx) || levelUp;
    session.periodic = { genre: session.genre, progress: n, levelUp, capped: g.level >= proficiencyCap(state, ctx.balance) && !levelUp };
  }
  return results;
}

/** 熟練の進みを1問分進める（上限の Lv なら進まない）。Lv が上がったら { genre, level } を返す */
function addProgress(state, genre, ctx) {
  const g = genreState(state, genre);
  if (g.level >= proficiencyCap(state, ctx.balance)) return null;
  g.progress++;
  if (g.progress < ctx.balance.quiz.correctPerProficiencyLevel) return null;
  g.progress = 0;
  g.level++;
  return { genre, level: g.level };
}

/**
 * 学会の査読者（研究室の顧問）の要出典：問題を出したとき、口を挟んでいる魔物がいれば、その魔物が混ぜた俗説の選択肢（誤答1）に
 * 印（choice.cited）を付ける。眠るまでに balance.advisor.citationsPerSleep 回まで（眠ると戻る）。付けたら current.citedBy に名前
 */
function citeMyth(state, cur, ctx) {
  if (!advisorActive(state, ctx, 'reviewer') || citationsLeft(state, ctx) <= 0 || !interferingEnemy(state, cur.question, ctx)) return;
  const myth = cur.choices.find((c) => c.kind === 'myth');
  if (!myth) return;
  myth.cited = true;
  cur.citedBy = (ctx.monsters.find((m) => m.id === 'reviewer') || {}).name || '';
  state.citationsUsed = (state.citationsUsed || 0) + 1;
}

/**
 * 科学史（学際分野）：ボス（かつての学説）と戦っている間、誤答が1つ消える。
 * 消すのは俗説の枠（誤答1）ではない誤答。消したら current.trimmedBy に学際分野の名前を入れる
 */
function trimChoices(state, cur, ctx) {
  const id = 'history_of_science';
  if (!fieldActive(state, ctx, id) || !state.adventure.enemies.some((e) => e.kind === 'boss')) return;
  const wrong = cur.choices.filter((c) => c.kind === 'wrong');
  if (!wrong.length) return;
  cur.choices.splice(cur.choices.indexOf(wrong[Math.floor(ctx.rng() * wrong.length)]), 1);
  cur.trimmedBy = fieldById(ctx, id).name;
}

/** 決まった問題を出す（nextQuestion の中身。テストでも使う） */
export function presentQuestion(session, q, ctx) {
  session.asked.push(q.id);
  session.current = {
    question: q,
    choices: buildChoices(q, ctx.rng),
    timeLimit: timeLimitFor(q.difficulty, ctx.balance),
  };
  return session.current;
}

/** この問題に関連する魔物が今の群れにいれば、その敵（口を挟めるかどうかは問わない） */
function relatedEnemy(state, question, ctx) {
  if (!question.monster) return null;
  const m = ctx.monsters.find((x) => x.name === question.monster);
  if (!m) return null;
  return state.adventure.enemies.find((e) => e.monsterId === m.id) || null;
}

/** 行動経済学（学際分野）：経済系の俗説の魔物（genres が blockGenres に入る）は口を挟めない。封じた学際分野を返す */
function blockedBy(state, monsterId, ctx) {
  const f = fieldById(ctx, 'behavioral_economics');
  if (!f || !fieldActive(state, ctx, f.id)) return null;
  const m = ctx.monsters.find((x) => x.id === monsterId);
  return m && (m.genres || []).some((g) => (f.blockGenres || []).includes(g)) ? f : null;
}

/** この問題に口を挟んでいる敵（今の群れの中に関連する魔物がいるとき。学際分野で封じた魔物は除く）。いなければ null */
export function interferingEnemy(state, question, ctx) {
  const e = relatedEnemy(state, question, ctx);
  return e && !blockedBy(state, e.monsterId, ctx) ? e : null;
}

/** 口を挟もうとしたが学際分野で封じられた魔物：{ monster, field }（いなければ null） */
export function blockedInterference(state, question, ctx) {
  const e = relatedEnemy(state, question, ctx);
  const f = e && blockedBy(state, e.monsterId, ctx);
  return f ? { monster: ctx.monsters.find((m) => m.id === e.monsterId), field: f } : null;
}

/** この問題に口を挟んでいる魔物（monsters.json の定義）。いなければ null */
export function interferingMonster(state, question, ctx) {
  const e = interferingEnemy(state, question, ctx);
  return e ? ctx.monsters.find((m) => m.id === e.monsterId) || null : null;
}

function pushRecent(state, id, ctx) {
  const r = state.knowledge.recent;
  const i = r.indexOf(id);
  if (i >= 0) r.splice(i, 1);
  r.push(id);
  while (r.length > ctx.balance.quiz.recentAvoid) r.shift();
}

/**
 * 答える。choiceIndex が null なら時間切れ（不正解）。
 * 干渉の判定は答えた瞬間の敵の群れで行う。
 * 正解：干渉していればその魔物に大ダメージ、そうでなければ群れの先頭にダメージ。
 * 俗説（誤答1）を選んだ：干渉している魔物が回復する。
 * 返り値の events は sim.tick と同じ形（描画・通知用）
 */
export function answer(state, session, choiceIndex, ctx) {
  const cur = session.current;
  const q = cur.question;
  const qb = ctx.balance.quiz;
  const choice = choiceIndex == null ? null : cur.choices[choiceIndex];
  const correct = !!choice && choice.kind === 'answer';
  const k = state.knowledge;
  const g = genreState(state, q.genre);
  const relatedMonster = q.monster ? ctx.monsters.find((m) => m.name === q.monster) || null : null;
  const interferer = interferingEnemy(state, q, ctx);
  const blocked = blockedInterference(state, q, ctx);
  const target = interferer || state.adventure.enemies[0] || null;
  const events = [];
  const res = {
    correct, timeout: choiceIndex == null, chose: choice ? choice.kind : null,
    interfered: !!interferer, monsterId: relatedMonster ? relatedMonster.id : null,
    blocked: blocked ? { name: blocked.monster.name, field: blocked.field.name } : null, // 学際分野で口出しを封じた魔物
    targetName: target ? target.name : null,
    targetMidboss: target && target.kind === 'midboss' ? target.monsterId : null,
    levelUp: null, fooled: false, damage: 0, healed: 0, defeated: false, midbossBroken: false,
    zukan: [], events,
  };

  g.studied = true;
  pushRecent(state, q.id, ctx);

  if (correct) {
    g.correct++;
    k.totalCorrect++;
    res.levelUp = addProgress(state, q.genre, ctx);
    const ri = k.review.indexOf(q.id);
    if (ri >= 0) k.review.splice(ri, 1);
    // 破りすてた問題も、正解すると補習から外れる
    const ti = k.torn.indexOf(q.id);
    if (ti >= 0) { k.torn.splice(ti, 1); res.untorn = true; }
    if (relatedMonster && raiseZukan(state, relatedMonster.id, 2, events)) res.zukan.push({ monsterId: relatedMonster.id, stage: 2 });

    // 中ボスの防御は累計の正解数で崩れる（出てくる前の正解も数える）
    if (breakMidbosses(state, ctx, events).length) res.midbossBroken = true;
    // 月面のボス（カンペキキュウ）：正解するたびに、つるつるの月に山と影が描き足される
    markSmooth(state, ctx, events);
    if (target) {
      // 中ボスには正解のダメージを小さくする（勉強だけで一気に倒せないように）
      const ratio = interferer ? qb.interferedCorrectDamageRatio
        : target.kind === 'midboss' ? (qb.midbossDamageRatio ?? qb.correctDamageRatio) : qb.correctDamageRatio;
      res.damage = damageEnemy(state, Math.ceil(target.maxHp * ratio), ctx, events, 'quiz', target);
      res.defeated = !state.adventure.enemies.includes(target);
    }
  } else {
    if (!k.review.includes(q.id)) k.review.push(q.id);
    if (interferer && choice && choice.kind === 'myth') {
      res.fooled = true;
      zukanEntry(state, interferer.monsterId).fooled++;
      res.healed = healEnemy(state, interferer.maxHp * qb.mythHealRatio, events, interferer);
    }
  }

  session.results.push(res);
  session.index++;
  session.current = null;
  return res;
}

/* ================= 作問（ユーザーの問題の受付。40HzP の依頼） ================= */

// 作問者コードに使う字（見まちがえやすい 0・O・1・I は使わない）
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 作問者コード（例：K7Q2-9MXP）。採用された問題の author.code と同じなら、その人が作った問題 */
export function makeAuthorCode(rng) {
  const pick = () => CODE_CHARS[Math.floor(rng() * CODE_CHARS.length)];
  return Array.from({ length: 8 }, pick).join('').replace(/^(.{4})/, '$1-');
}

/** 作問者コードが無ければ決める（転生しても変わらない：legacy）。コードを返す */
export function ensureAuthorCode(state, rng) {
  const a = state.legacy.author;
  if (!a.code) a.code = makeAuthorCode(rng);
  return a.code;
}

/** 書きまちがいを吸収したコード（大文字・ハイフンと空白を除く） */
const normCode = (code) => String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

/** この人が作って採用された問題（questions.json の author.code が作問者コードと同じ） */
export function adoptedQuestions(state, ctx) {
  const mine = normCode(state.legacy.author.code);
  if (!mine) return [];
  return ctx.questions.filter((q) => q.author && normCode(q.author.code) === mine);
}

/** まだ知らせていない採用の問題を返し、知らせたことにする（起動したときに一度だけ知らせる） */
export function takeNewAdoptions(state, ctx) {
  const seen = state.legacy.author.seen;
  const fresh = adoptedQuestions(state, ctx).filter((q) => !seen.includes(q.id));
  for (const q of fresh) seen.push(q.id);
  return fresh;
}

/* ================= テストの結果をツイートする（40HzP の依頼） ================= */

/** ツイートに付けるハッシュタグ（ゲームの名前） */
export const SHARE_HASHTAG = 'ドット絵勉強RPG';

/**
 * テストの結果のツイートの文。results は gradeTest の戻り値。url はゲームの場所（公開した版だけ。無ければ付けない）。
 * 満点・0点・大喜利で答えた問題があれば、ひとこと足す
 */
export function testShareText({ name, genre, results, url = null }) {
  const total = results.length;
  const ok = results.filter((r) => r.correct).length;
  const oogiri = results.filter((r) => r.oogiri).length;
  const comment = (ok === total ? '満点！' : ok === 0 ? '0点…' : '') + (oogiri ? `（大喜利で答えた問題：${oogiri}問）` : '');
  return [`${name}は「${genre}」のテストで${total}問中${ok}問正解した！${comment}`, `#${SHARE_HASHTAG}`, url].filter(Boolean).join('\n');
}

/* ================= 新聞のビラ（月面のボス・ツキジンセツ） ================= */

/**
 * ツキジンセツが新聞のビラをまいている間、問題文のうち隠す部分 { start, length }。
 * 問題ごとに決まった場所（問題の id から決める。表示し直しても動かない）を、文の長さの hideRatio だけ隠す
 */
export function flyerSpan(question, hideRatio = 0.35) {
  const text = question.question;
  const length = Math.max(2, Math.min(text.length - 1, Math.round(text.length * hideRatio)));
  let h = 0;
  for (const ch of String(question.id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { start: h % Math.max(1, text.length - length + 1), length };
}

/* ================= 心理統計学（学際分野） ================= */

/**
 * どの俗説に騙されやすいか。図鑑の騙された回数を多い順に並べ、魔物のジャンルごとにも合計する。
 * review は過去問復習に残っている（間違えたままの）問題の数をジャンルごとに数えたもの
 */
export function fooledAnalysis(state, ctx) {
  const myths = ctx.monsters
    .map((m) => ({ monster: m, fooled: (state.knowledge.zukan[m.id] || {}).fooled || 0 }))
    .filter((x) => x.fooled > 0)
    .sort((a, b) => b.fooled - a.fooled);
  const count = (pairs) => Object.entries(pairs.reduce((acc, [k, n]) => ({ ...acc, [k]: (acc[k] || 0) + n }), {}))
    .map(([genre, n]) => ({ genre, count: n })).sort((a, b) => b.count - a.count);
  const reviewQs = state.knowledge.review.map((id) => ctx.questions.find((q) => q.id === id)).filter(Boolean);
  return {
    total: myths.reduce((sum, x) => sum + x.fooled, 0),
    myths,
    genres: count(myths.flatMap((x) => (x.monster.genres || []).map((g) => [g, x.fooled]))),
    review: count(reviewQs.map((q) => [q.genre, 1])),
  };
}
