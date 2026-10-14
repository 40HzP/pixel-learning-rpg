import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stageFor } from '../js/sim.js';

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
