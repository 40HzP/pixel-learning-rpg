import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stageFor } from '../js/sim.js';
import { createStageFade } from '../js/render.js';

const read = (rel) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
const { stages } = read('../data/stages.json');

test('10階層ごとの世界：1階層から始まり、背景のスプライトがそろっている', () => {
  assert.equal(stages[0].from, 1);
  for (let i = 1; i < stages.length; i++) assert.ok(stages[i].from > stages[i - 1].from, `${stages[i].name} の from が前より大きい`);
  for (const st of stages) {
    assert.ok(st.name, 'name');
    const file = fileURLToPath(new URL(`../../pixel/sprites/${st.background}.json`, import.meta.url));
    assert.ok(existsSync(file), `${st.background}.json がある`);
    const sp = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(sp.category, 'background', st.background);
    assert.deepEqual([sp.w, sp.h], [90, 160], st.background);
  }
  assert.ok(stages.at(-1).from >= 91, '100階層まで背景がある');
});

test('階層の背景：10階層ごとに変わり、最後の世界より先は最後の世界のまま', () => {
  const bg = (floor) => stageFor(floor, stages).background;
  assert.equal(bg(1), 'bg_floor01');
  assert.equal(bg(10), 'bg_floor01', '10階層の小ボスまでは最初の世界');
  assert.equal(bg(11), 'bg_floor11');
  assert.equal(bg(55), 'bg_floor51');
  assert.equal(bg(100), 'bg_floor91');
  assert.equal(bg(150), 'bg_floor91');
});

test('世界が変わるときは0.5秒の暗転：前半で暗くなり、真っ暗の瞬間に背景を入れ替え、後半で明るくなる', () => {
  const [a, b, c] = stages;
  const step = createStageFade(0.5);
  assert.deepEqual(step(a, 10), { shown: a, dark: 0 }, '最初の1回は暗転しない');
  assert.deepEqual(step(a, 11), { shown: a, dark: 0 }, '世界が同じなら暗転しない');
  assert.deepEqual(step(b, 12), { shown: a, dark: 0 }, '変わった瞬間はまだ前の世界');
  let r = step(b, 12.125);
  assert.equal(r.shown, a); assert.ok(Math.abs(r.dark - 0.5) < 1e-9, '0.125秒で半分暗い');
  r = step(b, 12.25);
  assert.equal(r.shown, b, '0.25秒（真っ暗）で新しい世界'); assert.equal(r.dark, 1);
  r = step(b, 12.375);
  assert.equal(r.shown, b); assert.ok(Math.abs(r.dark - 0.5) < 1e-9, '後半で明るくなる');
  assert.deepEqual(step(b, 12.5), { shown: b, dark: 0 }, '0.5秒で終わる');
  assert.deepEqual(step(b, 13), { shown: b, dark: 0 });

  // 明るくなる途中でまた変わったら、今の暗さから暗くなり直す（いきなり真っ暗にも真っ明るにもしない）
  step(c, 20);
  r = step(c, 20.375); assert.equal(r.shown, c);
  r = step(a, 20.375 + 1e-6);
  assert.equal(r.shown, c); assert.ok(Math.abs(r.dark - 0.5) < 1e-3, '暗さが続いている');
  r = step(a, 20.51);
  assert.equal(r.shown, a, 'もう一度真っ暗になって入れ替わる'); assert.ok(r.dark > 0.9);
  assert.deepEqual(step(a, 20.8), { shown: a, dark: 0 }, '終わると明るい');
});
