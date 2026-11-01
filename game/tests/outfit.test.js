import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { outfitOf, outfitKey, dressFrames, SWORD_FROM_X } from '../js/outfit.js';
import { items } from './helpers.js';

const read = (rel) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
const sprite = (name) => read(`../../pixel/sprites/${name}.json`);
const palette = new Set(read('../../pixel/palette.json').colors.map((c) => c.key));
const SWORD = new Set(['4', '3', 'f', 'g']);
const SKIN = new Set(['5', '6', '7', 's', 't']);
const outfit = (equipment) => outfitOf({ equipment }, items);
const ids = (slot) => items.filter((i) => i.slot === slot).map((i) => i.id);
// 剣を持つ絵（若い姿の待機と攻撃）と、杖を持つ年を取った姿
const ARMED = ['hero_idle', 'hero_attack', 'heroine_idle', 'heroine_attack'];
const OLD = ['hero_old_idle', 'hero_old_attack', 'heroine_old_idle', 'heroine_old_attack'];
const diff = (a, b) => a.flatMap((f, i) => f.flatMap((r, y) => [...r].flatMap((c, x) => (c !== b[i][y][x] ? [[i, x, y]] : []))));

test('品物には見た目（look）があり、使う色はパレットにある。枠ごとに決まった形', () => {
  for (const it of items) {
    assert.ok(it.look, `${it.name} に look がある`);
    const colors = it.slot === 'accessory' ? it.look.colors || [] : Object.values(it.look);
    for (const c of colors) assert.ok(palette.has(c), `${it.name} の色 ${c} はパレットにある`);
    if (it.slot === 'weapon') assert.deepEqual(Object.keys(it.look).sort(), ['blade', 'guard', 'guardLight', 'tip']);
    if (it.slot === 'armor') assert.deepEqual(Object.keys(it.look).sort(), ['cloth', 'collar', 'collarLight', 'light', 'shade']);
    if (it.slot === 'accessory') {
      assert.ok(['shoes', 'brooch', 'glasses', 'cape'].includes(it.look.type), it.name);
      if (it.look.type !== 'glasses') assert.ok(colors.length >= 1, `${it.name} は色がある`);
    }
  }
  // 武器どうし・防具どうしは見た目がちがう
  for (const slot of ['weapon', 'armor']) {
    const looks = items.filter((i) => i.slot === slot).map((i) => JSON.stringify(i.look));
    assert.equal(new Set(looks).size, looks.length, `${slot} の見た目は重ならない`);
  }
});

test('付けている装備を読む。付けていない枠・無い品物は null。組み合わせごとに名前がちがう', () => {
  const o = outfit({ weapon: 'katana', armor: null, accessory: 'cape' });
  assert.deepEqual([o.weapon.id, o.armor, o.accessory.id], ['katana', null, 'cape']);
  assert.equal(outfit({ weapon: 'no_such_item' }).weapon, null);
  assert.notEqual(outfitKey(o), outfitKey(outfit({ weapon: 'katana', accessory: 'clover' })));
  assert.equal(outfitKey(outfit({})), '-|-|-');
});

test('武器を付けていないと剣が消えて素手になる（剣の輪郭も残らない。手は残る）', () => {
  for (const name of ARMED) {
    const sp = sprite(name);
    const bare = dressFrames(sp.frames, outfit({}), true);
    bare.forEach((f, i) => {
      const colored = (x, y) => f[y] && f[y][x] !== undefined && f[y][x] !== '.' && f[y][x] !== '0';
      let skin = 0;
      f.forEach((r, y) => [...r].forEach((c, x) => {
        if (x < SWORD_FROM_X) return;
        assert.ok(!SWORD.has(c), `${name} ${i + 1}枚目 (${x},${y})：剣の色が残っていない`);
        if (SKIN.has(c)) skin++;
        if (c === '0') {
          const near = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].some(([dx, dy]) => colored(x + dx, y + dy));
          assert.ok(near, `${name} ${i + 1}枚目 (${x},${y})：剣の輪郭だけが残っていない`);
        }
      }));
      assert.ok(skin > 0, `${name} ${i + 1}枚目：素手の手がある`);
      // 頭と体（剣より左）は変わらない
      f.forEach((r, y) => assert.equal(r.slice(0, SWORD_FROM_X - 1), sp.frames[i][y].slice(0, SWORD_FROM_X - 1)));
    });
  }
});

test('武器ごとに剣の色が変わる（剣より左は変わらない）。鉄の剣はもとの絵のまま', () => {
  for (const name of ARMED) {
    const sp = sprite(name);
    assert.deepEqual(dressFrames(sp.frames, outfit({ weapon: 'iron_sword' }), true), sp.frames, `${name}：鉄の剣はもとの絵`);
    const looks = new Set();
    for (const w of ids('weapon')) {
      const f = dressFrames(sp.frames, outfit({ weapon: w }), true);
      assert.ok(diff(f, sp.frames).every(([, x]) => x >= SWORD_FROM_X), `${name} ${w}：変わるのは剣だけ`);
      looks.add(JSON.stringify(f));
    }
    assert.equal(looks.size, ids('weapon').length, `${name}：武器ごとに見た目がちがう`);
  }
});

test('防具ごとに服（頭より下）の色が変わる。年を取った姿も。武器は年を取った姿の杖を変えない', () => {
  for (const name of [...ARMED, ...OLD]) {
    const sp = sprite(name);
    const armed = ARMED.includes(name);
    const base = dressFrames(sp.frames, outfit({ weapon: 'iron_sword' }), armed);
    const looks = new Set([JSON.stringify(base)]);
    for (const a of ids('armor')) {
      const f = dressFrames(sp.frames, outfit({ weapon: 'iron_sword', armor: a }), armed);
      const d = diff(f, base);
      assert.ok(d.length > 0, `${name} ${a}：服の色が変わる`);
      assert.ok(d.every(([, , y]) => y >= 9), `${name} ${a}：頭は変わらない`);
      looks.add(JSON.stringify(f));
    }
    assert.equal(looks.size, ids('armor').length + 1, `${name}：防具ごと（と、防具なし）に見た目がちがう`);
    if (!armed) for (const w of ids('weapon')) assert.deepEqual(dressFrames(sp.frames, outfit({ weapon: w }), false), sp.frames, `${name}：杖のまま`);
  }
});

test('装飾品は、どの姿でも見た目のどこかが変わる（メガネは顔、ほかは頭より下）', () => {
  for (const name of [...ARMED, ...OLD]) {
    const sp = sprite(name);
    const armed = ARMED.includes(name);
    for (const armor of [null, 'samurai_armor']) {
      const base = dressFrames(sp.frames, outfit({ weapon: 'iron_sword', armor }), armed);
      for (const c of ids('accessory')) {
        const f = dressFrames(sp.frames, outfit({ weapon: 'iron_sword', armor, accessory: c }), armed);
        const d = diff(f, base);
        assert.ok(sp.frames.every((_, i) => d.some(([j]) => j === i)), `${name} ${c}（防具 ${armor}）：どの枚でも変わる`);
        const look = items.find((i) => i.id === c).look;
        if (look.type !== 'glasses') assert.ok(d.every(([, , y]) => y >= 9), `${name} ${c}：頭は変わらない`);
        else assert.ok(d.every(([, , y]) => y < 9), `${name} ${c}：メガネは顔だけ`);
        for (const r of f.flat()) for (const ch of r) assert.ok(ch === '.' || palette.has(ch));
        assert.deepEqual(f.map((r) => r.map((s) => s.length)), sp.frames.map((r) => r.map((s) => s.length)), '大きさは同じ');
      }
    }
  }
});
