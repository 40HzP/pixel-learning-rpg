// 色の見え方が違う人生（設計ページ「色の見え方が違う人生（2026-11-20）」。docs/decisions.md「色の見え方が違う人生」）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tick, reincarnate, heroStats, lifeLogHighlights, genreState, rollVision, rollsVision, visionChances, visionChancesVisible, checkVision, HOURS_PER_YEAR,
} from '../js/sim.js';
import { VISION_TYPES, visionFilter, simulateLinear } from '../js/colorsim.js';
import { fieldById, setMajor } from '../js/fields.js';
import { serialize, deserialize } from '../js/save.js';
import { balance, makeCtx, newGame, constRng } from './helpers.js';

/** 2世代目の人生（生まれ変わって、始まりの画面で性別を選んだところ） */
function secondLife(gender = 'male') {
  const s = newGame(0);
  s.life.generation = 2;
  s.hero.gender = gender;
  return s;
}
/** 乱数を何回使ったか数える */
function countingRng(v) {
  const rng = () => { rng.calls++; return v; };
  rng.calls = 0;
  return rng;
}

test('データ：確率は性別ごとに1型・2型・3型。1型・2型（X染色体の遺伝）は男性のほうが高く、3型（7番染色体）は男女で同じ', () => {
  const v = balance.vision;
  for (const g of ['male', 'female']) {
    for (const t of VISION_TYPES) assert.ok(v[g][t] > 0 && v[g][t] < 0.1, `${g} ${t}`);
  }
  assert.ok(v.male.protan > v.female.protan && v.male.deutan > v.female.deutan);
  assert.equal(v.male.tritan, v.female.tritan);
  assert.ok(v.male.deutan > v.male.protan, '日本人男性では2型が1型より多い');
});

test('1世代目は決めない（乱数も使わない）。生まれ変わった人生では、選んだ性別の確率で決まる', () => {
  const ctx = makeCtx();
  const first = newGame(0);
  const rng = countingRng(0);
  assert.equal(rollsVision(first, ctx), false);
  assert.equal(rollVision(first, ctx, rng), null);
  assert.equal(rng.calls, 0, '1世代目は乱数を使わない');

  for (const gender of ['male', 'female']) {
    const ch = visionChances(ctx, gender);
    const at = (r) => rollVision(secondLife(gender), ctx, constRng(r));
    assert.equal(at(ch.protan / 2), 'protan', `${gender}：1型`);
    assert.equal(at(ch.protan + ch.deutan / 2), 'deutan', `${gender}：2型`);
    assert.equal(at(ch.protan + ch.deutan + ch.tritan / 2), 'tritan', `${gender}：3型`);
    assert.equal(at(ch.protan + ch.deutan + ch.tritan), null, `${gender}：それ以外はふつう`);
    assert.equal(at(0.9), null);
  }
  assert.equal(visionChances(ctx, 'female').deutan, balance.vision.female.deutan, '女の子は female の表');
});

test('7歳の小学校教師が出てくる場面で分かる（一度だけ。熟練の記録に1行）。ふつうの見え方の人生では何も起きない', () => {
  const ctx = makeCtx(constRng(0.3));
  const plain = secondLife();
  plain.life.gameHours = 7 * HOURS_PER_YEAR;
  plain.hero.hp = 1e9;
  const ev0 = tick(plain, 1, ctx);
  assert.ok(ev0.some((e) => e.type === 'midbossReady'));
  assert.ok(!ev0.some((e) => e.type === 'visionCheck'));
  assert.ok(!plain.knowledge.profLog.some((c) => c.vision));

  const s = secondLife();
  s.life.vision = 'deutan';
  s.hero.hp = 1e9;
  assert.ok(!tick(s, 1, ctx).some((e) => e.type === 'visionCheck'), '生まれた瞬間には知らせない');
  assert.equal(s.life.visionKnown, false);
  s.life.gameHours = 7 * HOURS_PER_YEAR;
  const ev = tick(s, 1, ctx);
  const check = ev.find((e) => e.type === 'visionCheck');
  assert.deepEqual(check, { type: 'visionCheck', vision: 'deutan', monsterId: 'teacher_elementary' });
  assert.equal(s.life.visionKnown, true);
  assert.deepEqual(s.knowledge.profLog.filter((c) => c.vision).map((c) => [c.vision, c.reason, c.gen, c.age]), [['deutan', 'check', 2, 7]]);
  assert.equal(checkVision(s, ctx, []), false, '一度だけ');
  assert.ok(!tick(s, 10, ctx).some((e) => e.type === 'visionCheck'));
});

test('強さ・ゴールド・経験値には一切効かない', () => {
  const ctx = makeCtx(constRng(0.3));
  const a = secondLife();
  const b = secondLife();
  b.life.vision = 'tritan';
  for (const s of [a, b]) { s.hero.level = 50; s.adventure.floor = 20; }
  assert.deepEqual(heroStats(b, ctx), heroStats(a, ctx));
  tick(a, 30, ctx);
  tick(b, 30, ctx);
  assert.equal(b.gold, a.gold);
  assert.equal(b.hero.totalExp, a.hero.totalExp);
});

test('生まれ変わると前世のまとめに色の見え方が残り、新しい人生はふつうから（始まりの画面で決め直す）。前のセーブはふつうとして読む', () => {
  const ctx = makeCtx();
  const s = secondLife();
  s.life.vision = 'protan';
  s.life.visionKnown = true;
  const prev = reincarnate(s, ctx);
  assert.equal(prev.vision, 'protan');
  assert.equal(s.legacy.lives.at(-1).vision, 'protan');
  assert.equal(s.life.vision, null);
  assert.equal(s.life.visionKnown, false);
  // 生まれ変わりの場面の数行は熟練の記録から選ぶが、色の見え方の行は場面が別に出すので選ばない
  s.knowledge.profLog = [{ gen: 2, age: 7, vision: 'protan', reason: 'check' }, { gen: 2, age: 5, genre: '生物', from: 0, to: 1, reason: 'study' }];
  assert.deepEqual(lifeLogHighlights(s, 2).map((c) => c.genre), ['生物']);

  const old = JSON.parse(serialize(newGame(0), 0));
  delete old.state.life.vision;
  delete old.state.life.visionKnown;
  const loaded = deserialize(JSON.stringify(old), balance);
  assert.equal(loaded.life.vision, null);
  assert.equal(loaded.life.visionKnown, false);
});

test('確率論（数学＋統計学）を専攻にしていると、生まれ変わるときの確率が見える', () => {
  const ctx = makeCtx();
  const s = secondLife();
  assert.equal(visionChancesVisible(s, ctx), false);
  for (const g of fieldById(ctx, 'probability').genres) genreState(s, g).level = 5;
  tick(s, 0.01, ctx); // 学際分野の解放
  assert.equal(setMajor(s, 0, 'probability', ctx).ok, true);
  assert.equal(visionChancesVisible(s, ctx), true);
});

test('フィルタ（Brettel 1997・Viénot 1999）：白と黒は変わらない。その型の人に同じに見える色に置き換えるので、もう一度かけても変わらない', () => {
  const samples = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [0.2, 0.6, 0.3], [0.8, 0.3, 0.6], [0.1, 0.1, 0.9], [0.5, 0.5, 0.5]];
  for (const t of VISION_TYPES) {
    const f = visionFilter(t);
    assert.equal(f.matrices.length, t === 'tritan' ? 2 : 1, `${t}：3型だけ面が2枚`);
    for (const v of [[0, 0, 0], [1, 1, 1], [0.5, 0.5, 0.5]]) {
      simulateLinear(t, v).forEach((x, i) => assert.ok(Math.abs(x - v[i]) < 1e-6, `${t}：灰色 ${v} はそのまま`));
    }
    for (const c of samples) {
      const once = simulateLinear(t, c);
      if (once.some((x) => x <= 0 || x >= 1)) continue; // 画面で出せる色の外に出て切り詰めた色は比べない
      const twice = simulateLinear(t, once);
      twice.forEach((x, i) => assert.ok(Math.abs(x - once[i]) < 0.01, `${t}：${c} にもう一度かけても同じ`));
    }
  }
  // 1型・2型：赤と緑は、明るさのちがいだけになる（色味が同じ）
  for (const t of ['protan', 'deutan']) {
    const r = simulateLinear(t, [1, 0, 0]);
    const g = simulateLinear(t, [0, 1, 0]);
    assert.ok(Math.abs(r[0] / r[1] - g[0] / g[1]) < 1e-6, `${t}：赤と緑の色味が同じ`);
  }
  // 3型：青と緑は見分けにくくなる（ふつうより差が小さい）
  const dist = (a, b) => Math.hypot(...a.map((x, i) => x - b[i]));
  const blue = [0.1, 0.3, 0.9], green = [0.1, 0.6, 0.4];
  assert.ok(dist(simulateLinear('tritan', blue), simulateLinear('tritan', green)) < dist(blue, green));
});
