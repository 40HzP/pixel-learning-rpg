import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setAdvisor, setInParty, advisorActive, advisorsAt, advisorSlots, partyAllies, inParty, hireRecruit, spawnEnemy, sleep, reincarnate,
  ADVISOR_PLACES, nextBoss, bossState, citationsLeft, rocketBuildCost, payRocketBuildCost, foundCompany, hireStaff, companyProfit, genreState,
} from '../js/sim.js';
import {
  createSession, nextQuestion, presentTest, gradeTest, answer, recordTorn, remedialOpen, forgetMissingQuestions,
} from '../js/quiz.js';
import { fieldList } from '../js/fields.js';
import { serialize, deserialize } from '../js/save.js';
import { balance, monsters, questions, makeCtx, newGame, constRng, questionFor } from './helpers.js';

const byId = (id) => monsters.find((m) => m.id === id);
const ally = (id) => ({ id, name: byId(id).name, atk: 50, maxHp: 100, hp: 100, cd: 0.1 });

/** 中ボスだった仲間（ids）をつれた主人公 */
function withAllies(ids) {
  const s = newGame(7);
  s.allies.push(...ids.map(ally));
  s.gold = 1e6;
  return s;
}
const correctIndex = (cur) => cur.choices.findIndex((c) => c.kind === 'answer');

test('顧問：仲間になる中ボスはみな、置く場所（学校・研究室・会社・ロケット発射場）と役目を1つずつ持つ。孫は顧問にならない', () => {
  const mbs = monsters.filter((m) => m.kind === 'midboss');
  for (const m of mbs) {
    if (m.ally === false) { assert.equal(m.advisor, undefined, `${m.name}は仲間にならないので顧問にもならない`); continue; }
    assert.ok(m.advisor, `${m.name}に advisor がある`);
    assert.ok(ADVISOR_PLACES[m.advisor.place], `${m.name}の置く場所 ${m.advisor.place}`);
    assert.ok(m.advisor.role && m.advisor.desc, `${m.name}の役目と説明`);
  }
  for (const place of Object.keys(ADVISOR_PLACES)) assert.ok(advisorSlots(makeCtx(), place) >= 1, `${place}に顧問を置ける`);
  // 設計ページの置き場所
  assert.deepEqual(Object.fromEntries(mbs.filter((m) => m.advisor).map((m) => [m.id, m.advisor.place])), {
    teacher_elementary: 'school', teacher_junior: 'school', teacher_high: 'school', politician: 'rocket',
    professor: 'lab', interviewer: 'company', reviewer: 'lab', tax_inspector: 'company',
  });
});

test('顧問に置くとパーティーから外れて戦わない。場所ごとの枠を超えては置けない。やめさせると空きがあればパーティーに戻る', () => {
  const ctx = makeCtx();
  const s = withAllies(['teacher_elementary', 'teacher_junior', 'professor']);
  assert.equal(setAdvisor(s, 'teacher_elementary', true, ctx).ok, true);
  assert.equal(inParty(s.allies[0]), false);
  assert.deepEqual(partyAllies(s).map((a) => a.id), ['teacher_junior', 'professor']);
  assert.equal(advisorActive(s, ctx, 'teacher_elementary'), true);
  // 学校の枠は1人。中学校教師は置けない（小学校教師をやめさせると置ける）
  const full = setAdvisor(s, 'teacher_junior', true, ctx);
  assert.equal(full.ok, false);
  assert.match(full.reason, /学校の顧問の枠がいっぱい/);
  // 研究室は別の枠
  assert.equal(setAdvisor(s, 'professor', true, ctx).ok, true);
  assert.deepEqual(advisorsAt(s, ctx, 'lab').map((a) => a.id), ['professor']);
  // やめさせるとパーティーへ
  const off = setAdvisor(s, 'teacher_elementary', false, ctx);
  assert.equal(off.ok, true);
  assert.equal(off.benched, false);
  assert.equal(inParty(s.allies[0]), true);
  assert.ok(!('advisor' in s.allies[0]) && !('benched' in s.allies[0]), '印は残らない（セーブの形は前と同じ）');
  assert.equal(setAdvisor(s, 'teacher_junior', true, ctx).ok, true);
  // 顧問をパーティーに入れると、顧問ではなくなる
  assert.equal(setInParty(s, 'teacher_junior', true, ctx).ok, true);
  assert.equal(advisorActive(s, ctx, 'teacher_junior'), false);
  // 控えから顧問にもできる
  setInParty(s, 'teacher_junior', false, ctx);
  assert.equal(setAdvisor(s, 'teacher_junior', true, ctx).ok, true);
  assert.equal(s.allies[1].benched, undefined);
});

test('顧問をやめさせたとき、パーティーがいっぱいなら控えに戻る。契約した仲間は顧問にならない。仕組みがまだ無い役目（advisor.soon）は置けない', () => {
  const ctx = makeCtx();
  const s = withAllies(['teacher_high', 'tax_inspector']);
  assert.equal(setAdvisor(s, 'teacher_high', true, ctx).ok, true);
  for (const id of ['warrior', 'fighter', 'mage', 'priest']) assert.equal(hireRecruit(s, id, ctx).ok, true);
  assert.equal(partyAllies(s).length, balance.ally.partyMax);
  const off = setAdvisor(s, 'teacher_high', false, ctx);
  assert.equal(off.ok, true);
  assert.equal(off.benched, true);
  assert.equal(s.allies[0].benched, true);
  assert.equal(setAdvisor(s, 'warrior', true, ctx).ok, false);
  assert.equal(setAdvisor(s, 'tax_inspector', true, ctx).ok, true, '税務調査官は法人化ができたので置ける');
  // まだ仕組みが無い役目は置けない（データに soon を書いた場合）
  const later = { ...ctx, monsters: monsters.map((m) => (m.id === 'teacher_high' ? { ...m, advisor: { ...m.advisor, soon: '○○ができてから' } } : m)) };
  const soon = setAdvisor(s, 'teacher_high', true, later);
  assert.equal(soon.ok, false);
  assert.match(soon.reason, /○○ができてから/);
});

test('補習（小学校教師・学校）：破りすてたテストの問題を集めて出し、正解すると補習から外れる', () => {
  const ctx = makeCtx(constRng(0.3));
  const s = withAllies(['teacher_elementary']);
  const genre = questions[0].genre;
  const sess = createSession(s, 'test', ctx, genre);
  const sheet = presentTest(s, sess, ctx);
  assert.equal(recordTorn(s, sess), sheet.length);
  assert.equal(recordTorn(s, sess), 0, '同じ問題は2回入らない');
  assert.deepEqual(new Set(s.knowledge.torn), new Set(sheet.map((c) => c.question.id)));
  assert.equal(remedialOpen(s, ctx), false, '顧問に置くまでは補習は無い（破りすてた問題は覚えておく）');
  setAdvisor(s, 'teacher_elementary', true, ctx);
  assert.equal(remedialOpen(s, ctx), true);
  const rem = createSession(s, 'remedial', ctx);
  assert.equal(rem.total, Math.min(balance.quiz.testQuestions, sheet.length));
  const cur = nextQuestion(s, rem, ctx);
  assert.ok(s.knowledge.torn.includes(cur.question.id), '破りすてた問題から出る');
  const r = answer(s, rem, correctIndex(cur), ctx);
  assert.equal(r.untorn, true);
  assert.ok(!s.knowledge.torn.includes(cur.question.id), '正解すると外れる');
  // 間違えると残る（過去問復習にも入る）
  if (s.knowledge.torn.length) {
    const rem2 = createSession(s, 'remedial', ctx);
    const c2 = nextQuestion(s, rem2, ctx);
    answer(s, rem2, null, ctx);
    assert.ok(s.knowledge.torn.includes(c2.question.id));
    assert.ok(s.knowledge.review.includes(c2.question.id));
  }
  // もう無い問題はセーブから外す
  s.knowledge.torn.push('no-such-question');
  forgetMissingQuestions(s, ctx);
  assert.ok(!s.knowledge.torn.includes('no-such-question'));
});

test('定期テスト（中学校教師・学校）：テストで全問正解すると、熟練の進みが1問分多くなる。1問でも間違えると増えない', () => {
  const ctx = makeCtx(constRng(0.3));
  const genre = questions[0].genre;
  const play = (advisor, allRight) => {
    const s = withAllies(['teacher_junior']);
    if (advisor) setAdvisor(s, 'teacher_junior', true, ctx);
    const sess = createSession(s, 'test', ctx, genre);
    const sheet = presentTest(s, sess, ctx);
    const picks = sheet.map((cur, i) => (allRight || i > 0 ? correctIndex(cur) : null));
    const rs = gradeTest(s, sess, picks, ctx);
    return { s, sess, n: rs.length, ok: rs.filter((r) => r.correct).length };
  };
  const plain = play(false, true);
  const bonus = play(true, true);
  assert.equal(genreState(plain.s, genre).progress, plain.n);
  assert.equal(genreState(bonus.s, genre).progress, bonus.n + balance.advisor.periodicTestProgress);
  assert.deepEqual(bonus.sess.periodic, { genre, progress: balance.advisor.periodicTestProgress, levelUp: null, capped: false });
  assert.equal(plain.sess.periodic, null);
  const miss = play(true, false);
  assert.equal(genreState(miss.s, genre).progress, miss.ok);
  assert.equal(miss.sess.periodic, null);
});

test('進路指導（高校教師・学校）：未解放の学際分野のうち、解放にいちばん近いものだけ、もう片方のジャンルが分かる', () => {
  const ctx = makeCtx();
  const s = withAllies(['teacher_high']);
  const f = ctx.fields.fields.find((x) => x.group !== 'hidden');
  genreState(s, f.genres[0]).level = 2;
  genreState(s, f.genres[1]).level = 2;
  assert.ok(fieldList(s, ctx).every((x) => !x.hint || !x.hint.other), '顧問がいないと教えてくれない');
  const guided = fieldList(s, ctx, true).filter((x) => x.hint && x.hint.other);
  assert.equal(guided.length, 1);
  assert.equal(guided[0].id, f.id);
  assert.deepEqual([guided[0].hint.genre, guided[0].hint.other.genre].sort(), [...f.genres].sort());
});

test('予習（大学教授・研究室）：次に戦うボスは、今いる世界でまだ倒していないボスのうち、いちばん手前の階層', () => {
  const ctx = makeCtx();
  const s = newGame(7);
  const earth = monsters.filter((m) => m.kind === 'boss' && !m.world).sort((a, b) => a.floor - b.floor);
  assert.equal(nextBoss(s, ctx).id, earth[0].id);
  assert.ok(nextBoss(s, ctx).whyBelieved, '当時の根拠がある');
  bossState(s, earth[0].id).status = 'defeated';
  assert.equal(nextBoss(s, ctx).id, earth[1].id);
  s.adventure.world = 'moon';
  assert.equal(nextBoss(s, ctx).world, 'moon');
});

test('要出典（学会の査読者・研究室）：口を挟んでいる魔物の俗説に印を付ける。眠るまでに決まった回数だけで、眠ると戻る', () => {
  const ctx = makeCtx(constRng(0.5));
  const s = withAllies(['reviewer']);
  const q = questionFor('ツギハクロ');
  spawnEnemy(s, ctx, [], 'tsugihakuro');
  // 出したときに印を付ける（この問題を必ず出すため、候補を1問にする）
  const quiz = (st) => {
    const c = { ...ctx, questions: [q] };
    const sess = createSession(st, 'quiz', c);
    return nextQuestion(st, sess, c);
  };
  assert.ok(!quiz(s).choices.some((c) => c.cited), '顧問がいないと付かない');
  setAdvisor(s, 'reviewer', true, ctx);
  const per = balance.advisor.citationsPerSleep;
  for (let i = 0; i < per; i++) {
    const cur = quiz(s);
    assert.equal(cur.choices.find((c) => c.kind === 'myth').cited, true, `${i + 1}回目は印が付く`);
    assert.ok(cur.citedBy);
  }
  assert.equal(citationsLeft(s, ctx), 0);
  assert.ok(!quiz(s).choices.some((c) => c.cited), '使い切ると付かない');
  sleep(s, ctx);
  assert.equal(citationsLeft(s, ctx), per, '眠ると戻る');
  // 口を挟んでいる魔物がいないときは付けず、回数も減らない
  s.adventure.enemies = [];
  assert.ok(!quiz(s).choices.some((c) => c.cited));
  assert.equal(citationsLeft(s, ctx), per);
});

test('人事（就職面接官・会社）：社員が会社の利益を増やす効果が hrStaffBonus だけ大きくなる', () => {
  const ctx = makeCtx();
  const s = withAllies(['interviewer']);
  s.gold = 1e9;
  const ind = ctx.business.industries.find((i) => i.level === 1);
  genreState(s, ctx.business.unlock.genre).level = 1;
  assert.equal(foundCompany(s, ind.id, ctx).ok, true);
  const c = s.companies[0];
  assert.equal(hireStaff(s, c.uid, 'sales', ctx).ok, true);
  const before = companyProfit(s, c, ctx);
  setAdvisor(s, 'interviewer', true, ctx);
  const after = companyProfit(s, c, ctx);
  assert.ok(Math.abs(after.staffBonus - before.staffBonus * (1 + balance.advisor.hrStaffBonus)) < 1e-9);
  assert.ok(after.total > before.total);
});

test('補助金（政治家・ロケット発射場）：ロケットの建造費が rocketSubsidy の分だけ安くなる', () => {
  const ctx = makeCtx();
  const s = withAllies(['politician']);
  const full = balance.rocket.buildCost;
  assert.equal(rocketBuildCost(s, ctx), full);
  setAdvisor(s, 'politician', true, ctx);
  const cut = Math.round(full * (1 - balance.advisor.rocketSubsidy));
  assert.equal(rocketBuildCost(s, ctx), cut);
  s.gold = cut;
  const r = payRocketBuildCost(s, ctx);
  assert.equal(r.ok, true);
  assert.equal(r.cost, cut);
  assert.equal(s.gold, 0);
});

test('顧問と破りすてた問題はセーブに残る。生まれ変わると顧問（仲間）は最初からで、破りすてた問題（知識）は残る', () => {
  const ctx = makeCtx();
  const s = withAllies(['teacher_elementary']);
  setAdvisor(s, 'teacher_elementary', true, ctx);
  s.knowledge.torn.push(questions[0].id);
  s.citationsUsed = 2;
  const loaded = deserialize(serialize(s), balance);
  assert.equal(loaded.allies[0].advisor, true);
  assert.deepEqual(loaded.knowledge.torn, [questions[0].id]);
  assert.equal(loaded.citationsUsed, 2);
  // 前の版のセーブ（顧問・破りすてた問題の項目が無い）も読める
  const old = JSON.parse(serialize(s));
  delete old.state.knowledge.torn;
  delete old.state.citationsUsed;
  const fromOld = deserialize(JSON.stringify(old), balance);
  assert.deepEqual(fromOld.knowledge.torn, []);
  assert.equal(fromOld.citationsUsed, 0);
  reincarnate(s, ctx);
  assert.deepEqual(s.allies, []);
  assert.equal(s.citationsUsed, 0);
  assert.deepEqual(s.knowledge.torn, [questions[0].id]);
});
