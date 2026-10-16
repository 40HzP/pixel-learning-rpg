import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tick, startGame, reincarnate, lifespanOf, ailmentAge, treatmentInfo, receiveTreatment, HOURS_PER_YEAR } from '../js/sim.js';
import { serialize, deserialize } from '../js/save.js';
import { balance, makeCtx, newGame } from './helpers.js';

const read = (rel) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
const H = balance.hospital;
const BEFORE = balance.life.ailmentYearsBefore;

/** その年齢の少し手前にして、1秒進める（ゲーム内で約2.4日） */
const reach = (s, ctx, age) => { s.life.gameHours = age * HOURS_PER_YEAR - 1; return tick(s, 1, ctx); };

test(`体の不調：寿命の${BEFORE}年前（寿命80歳なら70歳）に一度だけ「体の不調を感じ始める」`, () => {
  const ctx = makeCtx();
  const s = newGame(7);
  s.hero.hp = 1e9;
  assert.equal(s.life.lifespan, 80);
  assert.equal(ailmentAge(s, balance), 80 - BEFORE);
  assert.ok(!reach(s, ctx, 69).some((e) => e.type === 'ailment'), '69歳ではまだ');
  assert.equal(s.life.ailing, false);
  const ev = reach(s, ctx, 70);
  assert.deepEqual(ev.find((e) => e.type === 'ailment'), { type: 'ailment', age: 70 });
  assert.equal(s.life.ailing, true);
  assert.ok(!tick(s, 1, ctx).some((e) => e.type === 'ailment'), '二度は出ない');
  // 寿命は生まれるたびに変わるので、不調の年齢も変わる（77歳なら67歳）
  const t = newGame(7);
  startGame(t, 7, undefined, 77);
  assert.equal(ailmentAge(t, balance), 77 - BEFORE);
  assert.ok(reach(t, ctx, 77 - BEFORE).some((e) => e.type === 'ailment'));
});

test(`病院の治療：不調を感じ始めてから受けられる。1回ごとに寿命が${H.extendYears}年延び、治療費は ${H.treatmentCosts.join('・')}G の順。${H.treatmentCosts.length}回まで`, () => {
  const ctx = makeCtx();
  const s = newGame(7);
  s.gold = 1e9;
  assert.equal(receiveTreatment(s, ctx).reason, '体の不調を感じ始めてから受けられる');
  reach(s, ctx, 70);
  let gold = s.gold;
  for (let i = 0; i < H.treatmentCosts.length; i++) {
    const t = treatmentInfo(s, ctx);
    assert.deepEqual([t.count, t.cost, t.ok], [i, H.treatmentCosts[i], true]);
    const r = receiveTreatment(s, ctx);
    assert.equal(r.ok, true);
    assert.equal(s.gold, gold - H.treatmentCosts[i]);
    gold = s.gold;
    assert.equal(lifespanOf(s, balance), 80 + H.extendYears * (i + 1));
    assert.equal(r.lifespan, lifespanOf(s, balance));
  }
  assert.equal(receiveTreatment(s, ctx).reason, 'これ以上の治療はできない');
  assert.equal(ailmentAge(s, balance), 80 - BEFORE, '治療で延びても、不調の年齢は動かない');
  // ゴールドが足りないと受けられない
  const p = newGame(7);
  reach(p, ctx, 70);
  p.gold = H.treatmentCosts[0] - 1;
  assert.equal(receiveTreatment(p, ctx).reason, 'ゴールドが足りません');
  assert.equal(lifespanOf(p, balance), 80);
});

test('治療で延びた寿命まで生きる。生まれ変わると不調と治療は最初から', () => {
  const ctx = makeCtx();
  const s = newGame(7);
  s.hero.hp = 1e9;
  s.gold = 1e9;
  reach(s, ctx, 70);
  receiveTreatment(s, ctx);
  assert.equal(lifespanOf(s, balance), 80 + H.extendYears);
  assert.ok(!reach(s, ctx, 80).some((e) => e.type === 'reincarnated'), '80歳ではまだ生きている');
  const ev = reach(s, ctx, 80 + H.extendYears);
  const re = ev.find((e) => e.type === 'reincarnated');
  assert.ok(re, '延びた寿命で生まれ変わる');
  assert.equal(re.life.age, 80 + H.extendYears);
  assert.deepEqual([s.life.ailing, s.life.treatments], [false, 0]);
  startGame(s, 0, undefined, 80);
  assert.equal(lifespanOf(s, balance), 80);
});

test('前のセーブ（不調と治療の項目が無い）は、不調なし・治療0回として読める', () => {
  const s = newGame(7);
  delete s.life.ailing;
  delete s.life.treatments;
  const back = deserialize(serialize(s), balance);
  assert.deepEqual([back.life.ailing, back.life.treatments], [false, 0]);
  assert.equal(lifespanOf(back, balance), 80);
  // もう不調の年齢を過ぎていれば、次の tick で不調を感じ始める（ムービーが流れる）
  back.life.gameHours = 75 * HOURS_PER_YEAR;
  back.hero.hp = 1e9;
  assert.ok(tick(back, 1, makeCtx()).some((e) => e.type === 'ailment'));
});

test('街に病院があり、年老いた主人公の絵（16×16・右向き・待機2枚）がある。ムービーの文が書いてある', () => {
  const town = read('../data/town.json');
  const h = town.facilities.find((f) => f.id === 'hospital');
  assert.ok(h, '街に病院がある');
  assert.equal(h.sprite, 'town_hospital');
  assert.ok(Array.isArray(h.ailmentMovie) && h.ailmentMovie.length >= 2, '体の不調のムービーの文');
  for (const line of h.ailmentMovie) assert.ok(!/\{(?!name\}|age\})[^}]*\}/.test(line), `使える差し込みは {name} と {age} だけ：${line}`);
  const old = read('../../pixel/sprites/hero_old_idle.json');
  assert.deepEqual([old.category, old.w, old.h, old.frames.length], ['character', 16, 16, 2]);
});
