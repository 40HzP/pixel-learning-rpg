import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GENRES } from '../js/genres.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const { groups } = JSON.parse(read('../data/genre-groups.json'));
const palette = new Set(JSON.parse(read('../../pixel/palette.json')).colors.map((c) => c.key));

test('テストのジャンルのボタン：38ジャンルがどれか1つのまとまりに1回ずつ入っている（genre-groups.json）', () => {
  const names = groups.flatMap((g) => g.genres.map((x) => x.name));
  assert.deepEqual([...names].sort(), [...GENRES].sort(), 'genres.js のジャンルと同じ（足したら genre-groups.json にも足す）');
  assert.equal(new Set(names).size, names.length, '同じジャンルは1回だけ');
  assert.equal(new Set(groups.map((g) => g.name)).size, groups.length, 'まとまりの名前は重ならない');
  for (const g of groups) assert.ok(palette.has(g.color), `${g.name} の色はパレットのキー（${g.color}）`);
});

test('テストのジャンルのボタン：アイコンは 16×16・category icon のスプライトで、ジャンルごとにちがう', () => {
  const icons = groups.flatMap((g) => g.genres.map((x) => x.icon));
  assert.equal(new Set(icons).size, icons.length);
  for (const name of icons) {
    const sp = JSON.parse(read(`../../pixel/sprites/${name}.json`));
    assert.deepEqual([sp.name, sp.category, sp.w, sp.h, sp.frames.length], [name, 'icon', 16, 16, 1], name);
    for (const row of sp.frames[0]) assert.ok([...row].every((c) => c === '.' || palette.has(c)), `${name} はパレットの色だけ`);
  }
});
