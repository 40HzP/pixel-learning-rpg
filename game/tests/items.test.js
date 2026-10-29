import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { heroStats, buyItem, equipItem, shopList, reincarnate, EQUIP_SLOTS, ITEM_STATS } from '../js/sim.js';
import { serialize, deserialize } from '../js/save.js';
import { balance, items, makeCtx, newGame } from './helpers.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const palette = new Set(JSON.parse(read('../../pixel/palette.json')).colors.map((c) => c.key));

test('品物：枠は武器・防具・装飾品のどれか。同じ枠では、後の品ほど強く、高く、多くの正解で入荷する', () => {
  assert.equal(new Set(items.map((i) => i.id)).size, items.length, 'id は重ならない');
  assert.equal(new Set(items.map((i) => i.name)).size, items.length, '名前は重ならない');
  const power = (it) => ITEM_STATS.reduce((n, k) => n + (it[k] || 0), 0);
  for (const slot of EQUIP_SLOTS) {
    const list = items.filter((i) => i.slot === slot);
    assert.ok(list.length >= 5, `${slot} は5品以上（${list.length}）`);
    for (let i = 1; i < list.length; i++) {
      const [a, b] = [list[i - 1], list[i]];
      assert.ok(power(b) > power(a), `${b.name} は ${a.name} より強い`);
      assert.ok(b.price > a.price, `${b.name} は ${a.name} より高い`);
      assert.ok(b.unlockCorrect >= a.unlockCorrect, `${b.name} は ${a.name} より後に入荷`);
    }
  }
  for (const it of items) {
    assert.ok(EQUIP_SLOTS.includes(it.slot), `${it.name} の枠（${it.slot}）`);
    assert.ok(power(it) > 0, `${it.name} は何かのステータスを足す`);
    for (const k of Object.keys(it)) assert.ok(['id', 'name', 'slot', 'icon', 'price', 'unlockCorrect', ...ITEM_STATS].includes(k), `${it.name} の項目 ${k}`);
  }
  assert.ok(items.filter((i) => i.slot === 'weapon').every((i) => Object.keys(i).filter((k) => ITEM_STATS.includes(k)).join() === 'atk'), '武器は攻撃だけ');
  assert.ok(items.filter((i) => i.slot === 'armor').every((i) => Object.keys(i).filter((k) => ITEM_STATS.includes(k)).join() === 'def'), '防具は防御だけ');
});

test('品物のアイコンは 16×16・category icon のスプライトで、品物ごとにちがう', () => {
  assert.equal(new Set(items.map((i) => i.icon)).size, items.length);
  for (const it of items) {
    const sp = JSON.parse(read(`../../pixel/sprites/${it.icon}.json`));
    assert.deepEqual([sp.name, sp.category, sp.w, sp.h, sp.frames.length], [it.icon, 'icon', 16, 16, 1], it.icon);
    for (const row of sp.frames[0]) assert.ok([...row].every((c) => c === '.' || palette.has(c)), `${it.icon} はパレットの色だけ`);
  }
});

test('装飾品：すばやさ・運・賢さを足す。買うと今の装飾品より強ければ付け替え、持っている品には「装備する」で戻せる', () => {
  const s = newGame(7);
  const ctx = makeCtx();
  s.knowledge.totalCorrect = 1000;
  s.gold = 1e9;
  const h0 = heroStats(s, ctx);
  const boots = items.find((i) => i.id === 'leather_boots');
  const clover = items.find((i) => i.id === 'clover');
  assert.deepEqual(buyItem(s, boots.id, ctx), { ok: true, equipped: true }, '空いていれば付ける');
  assert.equal(heroStats(s, ctx).agi, h0.agi + boots.agi);
  assert.deepEqual(buyItem(s, clover.id, ctx), { ok: true, equipped: true }, '強い（足す数の合計が大きい）ので付け替える');
  const h1 = heroStats(s, ctx);
  assert.deepEqual([h1.agi, h1.luck], [h0.agi, h0.luck + clover.luck], '装飾品は1つだけ');
  assert.equal(shopList(s, ctx).find((i) => i.id === boots.id).equipped, false);
  assert.deepEqual(equipItem(s, boots.id, ctx), { ok: true });
  assert.equal(s.equipment.accessory, boots.id);
  assert.equal(equipItem(s, boots.id, ctx).reason, 'もう装備しています');
  assert.equal(equipItem(s, 'cape', ctx).reason, '持っていない品物です');
  // 武器・防具・装飾品はそれぞれ別の枠
  buyItem(s, 'iron_sword', ctx);
  buyItem(s, 'iron_armor', ctx);
  assert.deepEqual(s.equipment, { weapon: 'iron_sword', armor: 'iron_armor', accessory: boots.id });
  const stone = items.find((i) => i.id === 'philosophers_stone');
  buyItem(s, stone.id, ctx);
  const h2 = heroStats(s, ctx);
  assert.deepEqual([h2.wis - h0.wis, h2.agi - h0.agi, h2.luck - h0.luck], [stone.wis, stone.agi, stone.luck], '賢者の石は3つ足す');
  equipItem(s, 'wood_sword', ctx).ok || buyItem(s, 'wood_sword', ctx);
  assert.equal(s.equipment.weapon, 'iron_sword', '弱い武器は買っても付けない');
  assert.deepEqual(equipItem(s, 'wood_sword', ctx), { ok: true }, '持っていれば付け替えられる');
});

test('装飾品の枠は前のセーブにも足され、生まれ変わると装備と一緒に無くなる', () => {
  const s = newGame(7);
  const ctx = makeCtx();
  delete s.equipment.accessory; // 前の版のセーブ（武器と防具だけ）
  const back = deserialize(serialize(s, 0), balance);
  assert.deepEqual(back.equipment, { weapon: null, armor: null, accessory: null });
  back.knowledge.totalCorrect = 100; back.gold = 1e6;
  buyItem(back, 'leather_boots', ctx);
  reincarnate(back, ctx);
  assert.deepEqual([back.equipment, back.owned], [{ weapon: null, armor: null, accessory: null }, []]);
});
