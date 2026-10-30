import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { monsters } from './helpers.js';

const spriteFile = (name) => fileURLToPath(new URL(`../../pixel/sprites/${name}.json`, import.meta.url));
const SIZE = { monster: 16, midboss: 16, boss: 32 };

test('monsters.json の sprites に書いた名前のスプライトがあり、大きさとカテゴリが合っている', () => {
  for (const m of monsters) {
    for (const name of [m.sprites.idle, m.sprites.attack]) {
      if (!name) continue; // スプライトがまだ無い魔物は null
      assert.ok(existsSync(spriteFile(name)), `${m.name}：${name}.json がある`);
      const sp = JSON.parse(readFileSync(spriteFile(name), 'utf8'));
      assert.equal(sp.name, name, `${name} の name`);
      assert.equal(sp.category, m.kind, `${name} の category`);
      assert.deepEqual([sp.w, sp.h], [SIZE[m.kind], SIZE[m.kind]], `${name} の大きさ`);
    }
  }
});

test('月面のボスの差分（描き足した山と影・分かれた地球と月・干上がった海）のスプライトがある', () => {
  const read = (name) => {
    assert.ok(existsSync(spriteFile(name)), `${name}.json がある`);
    return JSON.parse(readFileSync(spriteFile(name), 'utf8'));
  };
  for (const m of monsters) {
    for (const name of m.sprites.marked || []) {
      const sp = read(name);
      assert.deepEqual([sp.category, sp.w, sp.h, sp.frames.length], ['boss', 32, 32, 2], name);
    }
    for (const name of Object.values(m.sprites.parts || {})) {
      const sp = read(name);
      assert.deepEqual([sp.category, sp.w, sp.h, sp.frames.length], ['boss', 24, 24, 2], name);
    }
    if (m.remains) {
      const sp = read(m.remains.sprite);
      assert.deepEqual([sp.category, sp.w, sp.h], ['boss', 32, 32], m.remains.sprite);
      assert.ok(m.remains.note);
    }
  }
});

test('主人公の攻撃の絵（hero_attack）：突き出した剣の刃先まで入る（40HzP の依頼。24×16で、絵の端で切れない）', () => {
  const read = (name) => JSON.parse(readFileSync(spriteFile(name), 'utf8'));
  const idle = read('hero_idle');
  const attack = read('hero_attack');
  // 左の16×16が主人公（待機の絵と同じ位置・同じ高さ）。右に剣の分を広げた
  assert.deepEqual([attack.w, attack.h], [24, idle.h]);
  for (const [i, f] of attack.frames.entries()) {
    assert.ok(f.every((r) => r.at(-1) === '.'), `${i + 1}枚目：右の端の列に何も描かれていない（切れていない）`);
  }
  // 2枚目の剣は横に突き出し、刃先（輪郭）が16より右にある
  const thrust = attack.frames[1];
  assert.ok(thrust.some((r) => r.slice(16).includes('0')), '2枚目の刃先は16ドットより右');
});
