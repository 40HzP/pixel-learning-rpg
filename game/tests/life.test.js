import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tick, heroStats, lifespanFor, generationMultiplier, reincarnate, heroTitles, payRocketBuildCost, startGame,
  genreState, midbossState, foundCompany, companiesProfit, spawnGroup, damageEnemy, ageYears, HOURS_PER_YEAR,
  buyItem, shopList, hireRecruit, recruitList, industryList, hireStaff, bestStaffGrade, staffCost, proficiencyCap, sleep, receiveTreatment, canStartAt,
} from '../js/sim.js';
import { createSession, presentQuestion, answer } from '../js/quiz.js';
import { balance, questions, makeCtx, newGame, constRng, seededRng } from './helpers.js';

const M = balance.reincarnation.multiplier;

test('寿命は生まれるたびに 80歳 ± 3歳 で決まる', () => {
  const b = balance;
  assert.equal(lifespanFor(b, constRng(0.5)), b.life.lifespanYears);
  assert.equal(lifespanFor(b, constRng(0)), b.life.lifespanYears - b.life.lifespanSpread);
  assert.equal(lifespanFor(b, constRng(0.9999)), b.life.lifespanYears + b.life.lifespanSpread);
  const s = newGame(0);
  startGame(s, 7, '勇者', 82);
  assert.equal(s.life.lifespan, 82);
});

test('最初の案内の年齢：ゲームを初めて始めるとき（1世代目）は0歳からだけ。7歳からは生まれ変わったあとに選べる', () => {
  const s = newGame();
  assert.equal(canStartAt(s, 0), true);
  assert.equal(canStartAt(s, 7), false, '1世代目は7歳から始められない');
  s.life.gameHours = s.life.lifespan * HOURS_PER_YEAR;
  reincarnate(s, makeCtx());
  assert.equal(s.life.generation, 2);
  assert.equal(canStartAt(s, 0), true);
  assert.equal(canStartAt(s, 7), true, '生まれ変わったあとは7歳からも選べる');
});

test('寿命になると生まれ変わる。Lv・ゴールド・装備・仲間・会社・中ボス・ボスは最初から、知識・図鑑・称号・名前は残る', () => {
  const ctx = makeCtx(constRng(0.5));
  const s = newGame(7);
  s.hero.name = '勇者';
  s.hero.level = 120; s.hero.exp = 50; s.hero.totalExp = 99999;
  s.gold = 5e6;
  s.owned = ['wood_sword']; s.equipment.weapon = 'wood_sword';
  s.allies.push({ id: 'teacher_elementary', name: '小学校教師', atk: 1, maxHp: 1, hp: 1, cd: 1 });
  genreState(s, '経営学').level = 1;
  foundCompany(s, 'restaurant', ctx);
  midbossState(s, 'teacher_elementary').status = 'defeated';
  midbossState(s, 'grandchild').status = 'defeated';       // 称号「生き字引」
  s.bosses.tendousetsu = { status: 'defeated' };
  s.knowledge.totalCorrect = 300;
  s.knowledge.zukan.tsugihakuro = { stage: 2, fooled: 1 };
  s.knowledge.zukan.tendousetsu = { stage: 2, fooled: 0 };
  s.adventure.floor = 37; s.life.maxFloor = 40;
  s.life.lifespan = 80;
  s.life.gameHours = 80 * HOURS_PER_YEAR - 1;
  const ev = tick(s, 0.5, ctx);
  const re = ev.find((e) => e.type === 'reincarnated');
  assert.ok(re, '生まれ変わった');
  const { gold, ...rest } = re.life;
  assert.deepEqual(rest, { generation: 1, name: '勇者', age: 80, level: 120, maxFloor: 40, moonFloor: 0 });
  assert.ok(gold >= 5e6 - 12000, '前世の最後の所持金を記録する');
  assert.equal(re.generation, 2);
  // 最初からになるもの
  assert.equal(s.meta.startAge, null, '年齢を選ぶまで時間が止まる');
  assert.equal(s.life.generation, 2);
  assert.equal(s.life.gameHours, 0);
  assert.deepEqual([s.hero.level, s.hero.exp, s.hero.totalExp, s.gold], [1, 0, 0, 0]);
  assert.deepEqual([s.owned, s.equipment.weapon, s.allies, s.companies], [[], null, [], []]);
  assert.equal(s.adventure.floor, 1);
  assert.equal(midbossState(s, 'teacher_elementary').status, 'waiting', '中ボスにはまた会う');
  assert.deepEqual(s.bosses, {}, '前世で倒したボスにもまた会う（40HzP の依頼）');
  // 残るもの
  assert.equal(s.hero.name, '勇者');
  assert.equal(genreState(s, '経営学').level, 1);
  assert.equal(s.knowledge.totalCorrect, 300);
  assert.equal(s.knowledge.zukan.tsugihakuro.stage, 2);
  assert.equal(s.knowledge.zukan.tendousetsu.stage, 2, 'ボスの図鑑（正体）は残る');
  assert.deepEqual(heroTitles(s, ctx), ['生き字引']);
  assert.equal(s.legacy.lives.length, 1);
  assert.deepEqual(tick(s, 1, ctx), [], '年齢を選ぶまでは何も起きない');
});

test(`世代の倍率：2世代目はステータスの伸び・獲得経験値・獲得ゴールド（会社も）が ${M} 倍、3世代目は ${M * M} 倍`, () => {
  const ctx = makeCtx(constRng(0.5));
  const at = (gen) => { const s = newGame(7); s.life.generation = gen; return s; };
  assert.equal(generationMultiplier(at(1), balance), 1);
  assert.equal(generationMultiplier(at(2), balance), M);
  assert.equal(generationMultiplier(at(3), balance), M * M);
  // ステータスの伸び（初期値はそのまま、レベルごとの伸びが倍）
  const s1 = at(1), s2 = at(2);
  s1.hero.level = s2.hero.level = 21;
  const h1 = heroStats(s1, ctx), h2 = heroStats(s2, ctx);
  assert.equal(h2.atk, Math.floor(balance.hero.base.atk + balance.hero.perLevel.atk * M * 20));
  assert.ok(h2.maxHp > h1.maxHp && h2.agi > h1.agi && h2.luck > h1.luck);
  // 敵を倒したときの経験値とゴールド
  const kill = (s) => {
    s.hero.hp = 1e9; spawnGroup(s, ctx, [], ['tsugihakuro']);
    const ev = []; damageEnemy(s, 1e9, ctx, ev);
    return ev.find((e) => e.type === 'defeat');
  };
  const d1 = kill(at(1)), d2 = kill(at(2));
  assert.equal(d2.exp, Math.round(d1.exp * M));
  assert.ok(Math.abs(d2.gold - d1.gold * M) <= 1);
  // 会社の利益
  const c1 = at(1), c2 = at(2);
  for (const s of [c1, c2]) { genreState(s, '経営学').level = 1; s.gold = 1e9; foundCompany(s, 'restaurant', ctx); }
  assert.equal(companiesProfit(c2, ctx).total, Math.round(companiesProfit(c1, ctx).total * M));
});

test('ロケットの建造費（3000億G）を払うと、その工程は生まれ変わっても残る', () => {
  const ctx = makeCtx();
  const s = newGame(0);
  assert.equal(balance.rocket.buildCost, 300_000_000_000);
  s.gold = balance.rocket.buildCost - 1;
  assert.equal(payRocketBuildCost(s, ctx).reason, 'ゴールドが足りません');
  s.gold = balance.rocket.buildCost;
  assert.equal(payRocketBuildCost(s, ctx).ok, true);
  assert.equal(s.gold, 0);
  assert.equal(payRocketBuildCost(s, ctx).ok, false, '二度は払わない');
  reincarnate(s, ctx);
  assert.equal(s.legacy.rocket.buildCostPaid, true);
});

/**
 * 1〜3世代を通しで遊ぶ（勉強の進み方は仮定：経営学は12年ごとに+1（1世代目は12歳でLv1）、心理学は14年ごと、
 * 業種に関係するジャンルは20年ごと。2世代目からは引き継いだ知識から、熟練Lvの上限（5・10・15）まで上がり続ける）。
 * 届く業種のうち利益の一番大きいものを起業し、社員はいちばん優秀な質で雇う。
 * treat：病院の治療を受けられるだけ受けて、寿命を延ばす
 */
function playGenerations({ treat = false } = {}) {
  const ctx = makeCtx(seededRng(7));
  const s = newGame(0);
  const others = new Set(ctx.business.industries.flatMap((i) => i.genres));
  const best = { 1: 0, 2: 0, 3: 0 };
  let paidAt = null;
  let prev = { biz: 0, psy: 0, oth: 0 };
  for (let gen = 1; gen <= 3; gen++) {
    let k = prev;
    for (let t = 1; s.meta.startAge != null; t++) {
      if (t % 60 === 0) s.knowledge.totalCorrect++;
      const age = ageYears(s);
      // 前世の最後のLvから同じ速さで上がり続ける（上限は世代ごとの熟練Lvの上限）
      const cap = proficiencyCap(s, ctx.balance);
      const up = (p, rate) => Math.min(cap, p + Math.floor(age / rate));
      k = { biz: up(prev.biz, 12), psy: up(prev.psy, 14), oth: up(prev.oth, 20) };
      genreState(s, '経営学').level = k.biz;
      genreState(s, '心理学').level = k.psy;
      for (const g of others) if (g !== '経営学' && g !== '心理学') genreState(s, g).level = k.oth;
      tick(s, 1, ctx);
      if (s.meta.startAge == null) break;
      if (treat) while (receiveTreatment(s, ctx).ok);
      for (const it of shopList(s, ctx)) if (it.unlocked && !it.owned && s.gold >= it.price) buyItem(s, it.id, ctx);
      for (const r of recruitList(s, ctx)) if (!r.hired && s.gold >= r.monthlyCost * 3) hireRecruit(s, r.id, ctx);
      const can = industryList(s, ctx).filter((i) => i.unlocked && !i.founded && i.cost <= s.gold).sort((a, b) => b.monthlyProfit - a.monthlyProfit);
      if (can.length) foundCompany(s, can[0].id, ctx);
      const g = bestStaffGrade(s, ctx);
      for (const c of s.companies) for (const id of ['accountant', 'sales', 'planner', 'clerk']) {
        const cur = c.staff.find((x) => x.id === id);
        if ((!cur || cur.grade < g) && s.gold >= staffCost(ctx, id, g) * 6) hireStaff(s, c.uid, id, ctx);
      }
      best[gen] = Math.max(best[gen], s.gold);
      if (paidAt == null && s.gold >= ctx.balance.rocket.buildCost) paidAt = { gen, age };
    }
    prev = k;
    startGame(s, 0, undefined, 80);
  }
  return { best, paidAt };
}

test('会社の利益の目安：勉強を続けると、3世代目の50〜75歳ごろにロケットの建造費（3000億G）に届く。2世代目では届かない', () => {
  const { best, paidAt } = playGenerations();
  const cost = balance.rocket.buildCost;
  assert.ok(best[1] < cost * 0.2, `1世代目は遠い（最高 ${Math.round(best[1] / 1e8)}億）`);
  assert.ok(best[2] < cost && best[2] > cost * 0.4, `2世代目は届かないが近づく（最高 ${Math.round(best[2] / 1e8)}億）`);
  assert.ok(paidAt && paidAt.gen === 3 && paidAt.age >= 50 && paidAt.age <= 75, `3世代目の50〜75歳で届く（${JSON.stringify(paidAt)}）`);
});

test('病院で毎回すべての治療を受けて寿命を延ばしても、ロケットの建造費に届くのは3世代目（2世代目では届かない）', () => {
  const { best, paidAt } = playGenerations({ treat: true });
  const cost = balance.rocket.buildCost;
  assert.ok(best[2] < cost, `2世代目は届かない（最高 ${Math.round(best[2] / 1e8)}億）`);
  assert.ok(paidAt && paidAt.gen === 3, `3世代目で届く（${JSON.stringify(paidAt)}）`);
});

test('熟練Lvの上限は生まれ変わるたびに5ずつ上がる（1世代目5・2世代目10・3世代目15）。勉強でも睡眠でも上限まで上がる', () => {
  const ctx = makeCtx(constRng(0.01)); // 睡眠では必ず上がる
  const s = newGame(7);
  assert.equal(proficiencyCap(s, balance), 5);
  const q = questions[0];
  const g = genreState(s, q.genre);
  const correct = () => {
    const sess = createSession(s, 'quiz', ctx);
    const cur = presentQuestion(sess, q, ctx);
    return answer(s, sess, cur.choices.findIndex((c) => c.kind === 'answer'), ctx);
  };
  g.level = 5; g.progress = balance.quiz.correctPerProficiencyLevel - 1;
  correct();
  assert.equal(g.level, 5, '1世代目は5で止まる');
  reincarnate(s, ctx);
  assert.equal(s.life.generation, 2);
  assert.equal(proficiencyCap(s, balance), 10);
  assert.equal(g.level, 5, '熟練は引き継ぐ');
  g.progress = balance.quiz.correctPerProficiencyLevel - 1;
  const r = correct();
  assert.equal(g.level, 6, '2世代目は5を超えて上がる');
  assert.deepEqual(r.levelUp, { genre: q.genre, level: 6 });
  g.level = 9; g.studied = true;
  sleep(s, ctx);
  assert.equal(g.level, 10, '睡眠でも上限の10まで');
  g.studied = true;
  sleep(s, ctx);
  assert.equal(g.level, 10, '10で止まる');
  s.life.generation = 3;
  assert.equal(proficiencyCap(s, balance), 15);
});
