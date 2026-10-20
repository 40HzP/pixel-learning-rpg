import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
const spritePath = (name) => fileURLToPath(new URL(`../../pixel/sprites/${name}.json`, import.meta.url));
const town = read('../data/town.json');
const TOWN_W = 90, TOWN_H = 160;

// 地球の街と月面の街（town.json の moon）。月面にいる間は月面の街が出る
const TOWNS = [['地球の街', town], ['月面の街', town.moon]];

for (const [label, t] of TOWNS) test(`${label}：施設の外観と背景のスプライトがそろっている`, () => {
  const town = t;
  const bg = read(`../../pixel/sprites/${town.background}.json`);
  assert.deepEqual([bg.w, bg.h], [TOWN_W, TOWN_H]);
  for (const f of town.facilities) {
    assert.ok(f.id && f.name && f.desc, `${f.id} の名前と説明`);
    assert.ok(existsSync(spritePath(f.sprite)), `${f.sprite}.json がある`);
    const sp = read(`../../pixel/sprites/${f.sprite}.json`);
    assert.equal(sp.category, 'building', f.sprite);
  }
  assert.equal(new Set(town.facilities.map((f) => f.id)).size, town.facilities.length, 'id が重ならない');
  const need = label === '地球の街' ? ['shop', 'guild', 'home', 'rocket'] : ['moon_rocket', 'moon_base'];
  for (const id of need) assert.ok(town.facilities.some((f) => f.id === id), `${id} がある`);
});

for (const [label, t] of TOWNS) test(`${label}：建物と主人公は街の中に収まり、互いに重ならない`, () => {
  const town = t;
  const boxes = town.facilities.map((f) => {
    const sp = read(`../../pixel/sprites/${f.sprite}.json`);
    return { id: f.id, x: f.x, y: f.y, w: sp.w, h: sp.h };
  });
  boxes.push({ id: 'hero', x: town.hero.x, y: town.hero.y, w: 16, h: 16 });
  for (const b of boxes) {
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= TOWN_W && b.y + b.h <= TOWN_H, `${b.id} が街の中`);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert.ok(!overlap, `${a.id} と ${b.id} が重なっている`);
    }
  }
});
