import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tick, spawnGroup, chooseNextMonster, midbossState, challengeableMidboss, challengeMidboss, retreatMidboss, heroStats, heroTitles, nandeAnswered, nandeUnanswered, HOURS_PER_YEAR } from '../js/sim.js';
import { createSession, presentQuestion, answer } from '../js/quiz.js';
import { balance, monsters, makeCtx, newGame, questions, constRng, seededRng } from './helpers.js';

const correctOnce = (s, ctx) => {
  const sess = createSession(s, 'quiz', ctx);
  const cur = presentQuestion(sess, questions[0], ctx);
  return answer(s, sess, cur.choices.findIndex((c) => c.kind === 'answer'), ctx);
};

test('中ボスは自動では出ない。7歳になると挑戦できるようになり、そのことを一度だけ知らせる', () => {
  const ctx = makeCtx(constRng(0.3));
  const young = newGame(0);
  assert.equal(challengeableMidboss(young, ctx), null, '7歳になるまでは挑戦できない');
  const s = newGame(7);
  s.hero.hp = 1e9;
  assert.equal(challengeableMidboss(s, ctx).id, 'teacher_elementary');
  assert.equal(chooseNextMonster(s, ctx).kind, 'monster', '自動では出ない');
  const ev = tick(s, 10, ctx);
  assert.equal(ev.filter((x) => x.type === 'midbossReady').length, 1);
  assert.ok(!ev.some((x) => x.type === 'spawn' && x.kind === 'midboss'), '時間がたっても出てこない');
  assert.ok(!tick(s, 10, ctx).some((x) => x.type === 'midbossReady'), '知らせは一度だけ');
});

test('挑戦すると、今の敵の群れは退いて中ボスが1体で出る。戦っている間は挑戦ボタンを出さない', () => {
  const s = newGame(7);
  const ctx = makeCtx(constRng(0.3));
  spawnGroup(s, ctx, []);
  assert.ok(s.adventure.enemies.length > 1 && s.adventure.enemies.every((e) => e.kind === 'monster'));
  const ev = [];
  const e = challengeMidboss(s, ctx, ev);
  assert.equal(e.kind, 'midboss');
  assert.deepEqual(s.adventure.enemies, [e]);
  assert.equal(ev.find((x) => x.type === 'spawn').first, true);
  assert.equal(challengeableMidboss(s, ctx), null);
  assert.equal(challengeMidboss(s, ctx, []), null);
});

test('中ボスに負けると1階層に戻り、中ボスは出てこない。また挑戦できる', () => {
  const s = newGame(7);
  const ctx = makeCtx(constRng(0.5));
  challengeMidboss(s, ctx, []);
  s.hero.hp = 1;
  const ev = [];
  for (let i = 0; i < 30 && !ev.some((x) => x.type === 'heroDefeated'); i++) ev.push(...tick(s, 1, ctx));
  assert.ok(ev.some((x) => x.type === 'heroDefeated'));
  assert.equal(s.adventure.floor, 1);
  s.hero.hp = 1e9;
  const after = tick(s, 5, ctx);
  assert.ok(!after.some((x) => x.type === 'spawn' && x.kind === 'midboss'));
  assert.equal(challengeableMidboss(s, ctx).id, 'teacher_elementary');
  const again = [];
  challengeMidboss(s, ctx, again);
  assert.equal(again.find((x) => x.type === 'spawn').first, false, '2回目からは first にならない');
});

test('中ボス：累計の正解が5回になるまではダメージ0、その後は自動攻撃が効く（正解そのものではダメージは入らない）', () => {
  const s = newGame(7);
  const ctx = makeCtx(constRng(0.5));
  s.hero.hp = 99999;
  const e = challengeMidboss(s, ctx, []);
  assert.equal(e.kind, 'midboss');
  assert.deepEqual(s.adventure.enemies, [e], '中ボスは1体で出る');
  assert.equal(midbossState(s, e.monsterId).status, 'appeared');

  const hits = tick(s, 3, ctx).filter((x) => x.type === 'attack' && x.by === 'hero');
  assert.ok(hits.length >= 2);
  assert.ok(hits.every((x) => x.dmg === 0), '自動攻撃は0');
  assert.equal(e.hp, e.maxHp);

  for (let i = 1; i <= 4; i++) {
    const r = correctOnce(s, ctx);
    assert.equal(r.midbossBroken, false, `正解${i}回目ではまだ崩れない`);
  }
  const r5 = correctOnce(s, ctx);
  assert.equal(r5.midbossBroken, true);
  assert.equal(midbossState(s, e.monsterId).status, 'broken');
  assert.equal(e.hp, e.maxHp, '正解では中ボスにダメージは入らない（40HzP の依頼）');

  const hp = e.hp;
  const after = tick(s, 2, ctx).filter((x) => x.type === 'attack' && x.by === 'hero');
  assert.ok(after.length && after.every((x) => x.dmg > 0), '自動攻撃が効く');
  assert.ok(e.hp < hp || !s.adventure.enemies.includes(e));
});

test('中ボスを倒すと仲間になり、以後は出てこない', () => {
  const s = newGame(7);
  const ctx = makeCtx(constRng(0.5));
  s.hero.hp = 99999;
  const e = challengeMidboss(s, ctx, []);
  midbossState(s, e.monsterId).status = 'broken';
  e.hp = 1;
  const events = tick(s, 1, ctx);
  assert.ok(events.some((x) => x.type === 'allyJoined' && x.id === 'teacher_elementary'));
  assert.equal(s.allies.length, 1);
  assert.equal(midbossState(s, 'teacher_elementary').status, 'defeated');
  assert.equal(s.knowledge.zukan.teacher_elementary.stage, 2);
  assert.equal(chooseNextMonster(s, ctx).kind, 'monster');
  assert.equal(challengeableMidboss(s, ctx), null, '倒した中ボスには挑戦できない');
  const allyHits = tick(s, 5, ctx).filter((x) => x.type === 'attack' && x.by === 'ally');
  assert.ok(allyHits.length >= 1, '仲間も攻撃する');
});

test('中ボスが出る前の正解も数える：5問正解してから7歳になると、出てきた時点で攻撃が効く', () => {
  const s = newGame(0);
  const ctx = makeCtx(constRng(0.5));
  s.hero.hp = 99999;
  for (let i = 0; i < 5; i++) correctOnce(s, ctx);
  assert.equal(s.knowledge.totalCorrect, 5);
  s.life.gameHours = 7 * HOURS_PER_YEAR;
  s.adventure.enemies = [];
  const ev = [];
  const e = challengeMidboss(s, ctx, ev);
  assert.equal(e.kind, 'midboss');
  assert.equal(ev.find((x) => x.type === 'spawn').first, true);
  assert.equal(midbossState(s, e.monsterId).status, 'broken');
  const hits = tick(s, 2, ctx).filter((x) => x.type === 'attack' && x.by === 'hero');
  assert.ok(hits.length && hits.every((x) => x.dmg > 0), '最初から自動攻撃が効く');
});

test('出る前に3問・出てから2問の正解で防御が崩れる', () => {
  const s = newGame(0);
  const ctx = makeCtx(constRng(0.5));
  s.hero.hp = 99999;
  for (let i = 0; i < 3; i++) correctOnce(s, ctx);
  s.life.gameHours = 7 * HOURS_PER_YEAR;
  s.adventure.enemies = [];
  const e = challengeMidboss(s, ctx, []);
  assert.equal(midbossState(s, e.monsterId).status, 'appeared');
  const r4 = correctOnce(s, ctx);
  assert.equal(r4.midbossBroken, false);
  const r5 = correctOnce(s, ctx);
  assert.equal(r5.midbossBroken, true);
});

test('前の版のセーブ（中ボスが出ていて、累計の正解はもう5回以上）は、次の時間の進みで防御が崩れる', () => {
  const s = newGame(7);
  const ctx = makeCtx(constRng(0.5));
  s.hero.hp = 99999;
  const e = challengeMidboss(s, ctx, []);
  midbossState(s, e.monsterId).status = 'appeared';
  s.knowledge.totalCorrect = 12;
  const ev = tick(s, 0.1, ctx);
  assert.ok(ev.some((x) => x.type === 'midbossBroken' && x.monsterId === e.monsterId));
  assert.equal(midbossState(s, e.monsterId).status, 'broken');
});

const teacher = monsters.find((m) => m.id === 'teacher_elementary');

/** 防御が崩れた小学校教師と、指定のレベル・装備の主人公を戦わせる */
function fightTeacher(level, seed, weapon = 'wood_sword', armor = 'cloth') {
  const s = newGame(7);
  const ctx = makeCtx(seededRng(seed));
  Object.assign(s.equipment, { weapon, armor });
  s.hero.level = level;
  s.hero.hp = heroStats(s, ctx).maxHp;
  s.knowledge.totalCorrect = teacher.unlockCorrect;
  challengeMidboss(s, ctx, []);
  for (let t = 0; t < 120; t += 0.5) {
    for (const e of tick(s, 0.5, ctx)) {
      if (e.type === 'allyJoined') return 'win';
      if (e.type === 'heroDefeated') return 'lose';
    }
  }
  return 'draw';
}

test('小学校教師の強さは階層によらず決まっていて、主人公がレベル40くらいでないと倒せない', () => {
  const ctx = makeCtx(constRng(0.5));
  for (const floor of [1, 9]) {
    const s = newGame(7);
    s.adventure.floor = floor;
    const e = challengeMidboss(s, ctx, []);
    assert.deepEqual([e.maxHp, e.atk, e.def], [teacher.stats.hp, teacher.stats.atk, teacher.stats.def], `${floor}階層`);
  }
  const wins = (level) => [1, 2, 3, 4, 5, 6, 7, 8].filter((seed) => fightTeacher(level, seed, 'copper_sword', 'leather') === 'win').length;
  assert.ok(wins(40) >= 6, `Lv40（銅の剣・革の鎧）ならほぼ勝てる：${wins(40)}/8`);
  assert.equal(wins(37), 0, 'Lv37 では勝てない');
});

test('中ボスから逃げると、中ボスは退いて少ししてザコが出る。報酬はなく、また挑戦できる', () => {
  const s = newGame(7);
  const ctx = makeCtx(constRng(0.3));
  s.hero.hp = 1e9;
  challengeMidboss(s, ctx, []);
  const gold = s.gold, exp = s.hero.totalExp;
  const ev = [];
  assert.equal(retreatMidboss(s, ctx, ev), true);
  assert.ok(ev.some((x) => x.type === 'retreat' && x.name === '小学校教師'));
  assert.equal(s.adventure.enemies.length, 0);
  assert.equal(s.gold, gold);
  assert.equal(s.hero.totalExp, exp);
  assert.equal(midbossState(s, 'teacher_elementary').status, 'appeared', '倒したことにはならない');
  assert.equal(challengeableMidboss(s, ctx).id, 'teacher_elementary');
  tick(s, 2, ctx);
  assert.ok(s.adventure.enemies.length > 0 && s.adventure.enemies.every((e) => e.kind === 'monster'));
  assert.equal(retreatMidboss(s, ctx, []), false, '中ボスがいないときは逃げられない');
});

test('防御が崩れた中ボスにも、勉強の正解ではダメージは入らない（40HzP の依頼）', () => {
  const s = newGame(7);
  const ctx = makeCtx(constRng(0.5));
  s.hero.hp = 1e9;
  s.knowledge.totalCorrect = teacher.unlockCorrect;
  const e = challengeMidboss(s, ctx, []);
  const r = correctOnce(s, ctx);
  assert.equal(r.correct, true);
  assert.equal(e.hp, e.maxHp);
  assert.ok(!r.events.some((x) => x.type === 'attack'));
});

test('倒したときのミニムービー（defeatMovie）は空でない文の並び。小学校教師には2つある', () => {
  for (const m of monsters.filter((x) => 'defeatMovie' in x)) {
    assert.ok(Array.isArray(m.defeatMovie) && m.defeatMovie.length > 0, `${m.name} の defeatMovie は並び`);
    for (const line of m.defeatMovie) assert.ok(typeof line === 'string' && line.trim(), `${m.name} の文が空でない`);
  }
  assert.equal(monsters.find((m) => m.id === 'teacher_elementary').defeatMovie.length, 2);
});

const midbosses = monsters.filter((m) => m.kind === 'midboss');
/** 指定の中ボスより前の中ボスを倒したことにして、その年齢の主人公を作る */
function readyFor(id, age = null) {
  const m = midbosses.find((x) => x.id === id);
  const s = newGame(0);
  s.life.gameHours = (age ?? m.appearAge) * HOURS_PER_YEAR;
  for (const o of midbosses) { if (o.id === id) break; midbossState(s, o.id).status = 'defeated'; }
  return s;
}

test('中ボスは設計ページの9人。年齢の順に並び、1人ずつ挑む（前の中ボスを倒すまで次は知らせない）', () => {
  assert.deepEqual(midbosses.map((m) => m.name),
    ['小学校教師', '中学校教師', '高校教師', '政治家', '大学教授', '就職面接官', '学会の査読者', '税務調査官', '孫']);
  for (let i = 1; i < midbosses.length; i++) {
    assert.ok(midbosses[i].appearAge > midbosses[i - 1].appearAge, `${midbosses[i].name} は前より年上で出る`);
    assert.ok(midbosses[i].unlockCorrect >= midbosses[i - 1].unlockCorrect, `${midbosses[i].name} の必要な正解数`);
    assert.ok(midbosses[i].stats, `${midbosses[i].name} は決まった強さ`);
  }
  const ctx = makeCtx(constRng(0.3));
  const s = newGame(0);
  s.life.gameHours = 20 * HOURS_PER_YEAR; // 20歳でも、小学校教師を倒すまでは小学校教師だけ
  s.hero.hp = 1e9;
  const ev = tick(s, 1, ctx);
  assert.deepEqual(ev.filter((e) => e.type === 'midbossReady').map((e) => e.name), ['小学校教師']);
  assert.equal(challengeableMidboss(s, ctx).id, 'teacher_elementary');
  midbossState(s, 'teacher_elementary').status = 'defeated';
  assert.equal(challengeableMidboss(s, ctx).id, 'teacher_junior', '倒すと次は中学校教師');
  assert.deepEqual(tick(s, 1, ctx).filter((e) => e.type === 'midbossReady').map((e) => e.name), ['中学校教師']);
  assert.equal(challengeableMidboss(readyFor('teacher_high', 15), ctx), null, '16歳になるまで高校教師には挑めない');
});

/** 中ボスと、指定のレベル・装備の主人公を戦わせる（防御は崩れている） */
function fightMidboss(id, level, seed, weapon = 'iron_sword', armor = 'iron_armor') {
  const s = readyFor(id);
  const ctx = makeCtx(seededRng(seed));
  Object.assign(s.equipment, { weapon, armor });
  s.hero.level = level;
  s.hero.hp = heroStats(s, ctx).maxHp;
  s.knowledge.totalCorrect = 1000;
  const e = challengeMidboss(s, ctx, []);
  assert.equal(e.monsterId, id);
  for (let t = 0; t < 300; t += 0.5) {
    for (const ev of tick(s, 0.5, ctx)) {
      if (ev.type === 'defeat' && ev.kind === 'midboss') return 'win';
      if (ev.type === 'heroDefeated') return 'lose';
    }
  }
  return 'draw';
}

test('13歳から先の中ボスは、それぞれ決めたレベル（鉄の剣・鉄の鎧）でやっと倒せる', () => {
  const LEVEL = { teacher_junior: 55, teacher_high: 60, politician: 65, professor: 70, interviewer: 75, reviewer: 90, tax_inspector: 110, grandchild: 150 };
  for (const [id, L] of Object.entries(LEVEL)) {
    const m = midbosses.find((x) => x.id === id);
    const wins = (level) => [1, 2, 3, 4, 5, 6, 7, 8].filter((seed) => fightMidboss(id, level, seed) === 'win').length;
    assert.ok(wins(L) >= 6, `${m.name}：Lv${L} ならほぼ勝てる（${wins(L)}/8）`);
    assert.ok(wins(L - 3) <= 2, `${m.name}：Lv${L - 3} ではほぼ勝てない（${wins(L - 3)}/8）`);
  }
});

test('孫は倒しても仲間にならず、称号「生き字引」がもらえる', () => {
  const s = readyFor('grandchild');
  const ctx = makeCtx(seededRng(1));
  s.knowledge.totalCorrect = 1000;
  s.hero.level = 300;
  s.hero.hp = heroStats(s, ctx).maxHp;
  assert.deepEqual(heroTitles(s, ctx), []);
  challengeMidboss(s, ctx, []);
  const ev = [];
  for (let t = 0; t < 60 && !ev.some((e) => e.type === 'defeat'); t += 0.5) ev.push(...tick(s, 0.5, ctx));
  assert.ok(ev.some((e) => e.type === 'titleGained' && e.title === '生き字引'));
  assert.ok(!ev.some((e) => e.type === 'allyJoined'), '仲間にならない');
  assert.ok(!s.allies.some((a) => a.id === 'grandchild'));
  assert.deepEqual(heroTitles(s, ctx), ['生き字引']);
  assert.equal(challengeableMidboss(s, ctx), null, 'もう挑む中ボスはいない');
});

test('孫は戦っている間、firstSec 秒後から intervalSec 秒ごとに「なんで？」と聞いてくる（ほかの中ボスは聞かない）', () => {
  const nb = balance.nande;
  const count = (id) => {
    const s = readyFor(id);
    const ctx = makeCtx(constRng(0.5));
    s.hero.level = 400; s.hero.hp = 1e9; // 倒されないように（防御は崩れていないので倒しもしない）
    challengeMidboss(s, ctx, []);
    const times = [];
    for (let t = 0; t < nb.firstSec + nb.intervalSec * 2 + 0.5; t += 0.25) {
      for (const e of tick(s, 0.25, ctx)) if (e.type === 'nande') times.push(t + 0.25);
    }
    return times;
  };
  const times = count('grandchild');
  assert.equal(times.length, 3);
  assert.ok(Math.abs(times[0] - nb.firstSec) < 0.3, `最初は${nb.firstSec}秒後（${times[0]}）`);
  assert.ok(Math.abs(times[1] - times[0] - nb.intervalSec) < 0.3, `次は${nb.intervalSec}秒後`);
  assert.deepEqual(count('tax_inspector'), [], '税務調査官は聞かない');
});

test('孫の「なんで？」に答えられないと、孫のHPが回復する。正解すると孫にダメージ（勉強の正解では入らない）', () => {
  const s = readyFor('grandchild');
  const ctx = makeCtx(constRng(0.5));
  s.knowledge.totalCorrect = 1000; // 防御は崩れている
  const kid = challengeMidboss(s, ctx, []);
  kid.hp = kid.maxHp - Math.round(kid.maxHp * 0.3);
  const before = kid.hp;
  const healed = nandeUnanswered(s, ctx, []);
  assert.equal(healed, Math.round(kid.maxHp * balance.nande.wrongHealRatio));
  assert.equal(kid.hp, before + healed);
  const hp = kid.hp;
  correctOnce(s, ctx);
  assert.equal(kid.hp, hp, 'ふつうの勉強の正解ではダメージは入らない');
  const ev = [];
  const dmg = nandeAnswered(s, ctx, ev);
  assert.equal(dmg, Math.ceil(kid.maxHp * balance.nande.correctDamageRatio));
  assert.equal(kid.hp, hp - dmg);
  assert.ok(ev.some((x) => x.type === 'attack' && x.by === 'quiz' && x.dmg === dmg));
  assert.equal(nandeUnanswered(readyFor('grandchild'), ctx, []), 0, '孫がいなければ何もしない');
  assert.equal(nandeAnswered(readyFor('grandchild'), ctx, []), 0);
  // 防御が崩れる前は、なんで？に正解してもダメージ0
  const s2 = readyFor('grandchild');
  s2.knowledge.totalCorrect = 0;
  const kid2 = challengeMidboss(s2, ctx, []);
  assert.equal(nandeAnswered(s2, ctx, []), 0);
  assert.equal(kid2.hp, kid2.maxHp);
});
