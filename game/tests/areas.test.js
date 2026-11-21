// ザコの出現エリア（設計ページ「出現エリア」）：地球のザコは決まった世界（10階層ごとの世界）にしか出ない
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zakoPool, spawnGroup, areaLabels, stageRange } from '../js/sim.js';
import { monsters, stages, makeCtx, newGame, seededRng } from './helpers.js';

const earthStages = stages.filter((s) => (s.world || 'earth') === 'earth');
const earthZako = monsters.filter((m) => m.kind === 'monster' && (m.world || 'earth') === 'earth');
const byName = (name) => monsters.find((m) => m.name === name);

test('データ：地球のザコは1〜2つの出現エリア（stages.json の地球の世界の名前）を持ち、どの世界にもザコがいる', () => {
  const names = new Set(earthStages.map((s) => s.name));
  for (const m of earthZako) {
    assert.ok(Array.isArray(m.areas) && m.areas.length >= 1 && m.areas.length <= 2, `${m.name} の areas は1〜2つ`);
    for (const a of m.areas) assert.ok(names.has(a), `${m.name} の出現エリア「${a}」が stages.json にある`);
    assert.equal(new Set(m.areas).size, m.areas.length, `${m.name} の areas に同じ世界が2回ない`);
  }
  for (const s of earthStages) assert.ok(earthZako.some((m) => m.areas.includes(s.name)), `${s.name} に出るザコがいる`);
  // 月面のザコ・ボス・中ボスはエリアを持たない（月面は今のまま。ボスの手下はエリアに関係なく呼べる）
  for (const m of monsters.filter((x) => !earthZako.includes(x))) assert.equal(m.areas, undefined, `${m.name} は areas を持たない`);
});

// 100階層までの世界（設計ページの「ザコの出現エリア（一覧）」）と、101階層から先の世界（2026-11-21 にボスのイメージで足した。docs/decisions.md）
const firstWorlds = earthStages.filter((s) => s.from <= 91).map((s) => s.name);
const laterWorlds = earthStages.filter((s) => s.from > 91).map((s) => s.name);

test('データ：100階層までは設計ページの一覧のとおり（勉強法のザコは草原、2エリアに出るのはカゼコウセイ・ニドオチズ・ツギハクロの3体）', () => {
  const upTo100 = (m) => m.areas.filter((a) => firstWorlds.includes(a));
  for (const m of earthZako) assert.equal(firstWorlds.includes(m.areas[0]), true, `${m.name} の1つめの出現エリアは100階層までの世界`);
  for (const m of earthZako.filter((x) => x.genres.includes('勉強法'))) assert.deepEqual(upTo100(m), ['はじまりの草原'], m.name);
  assert.deepEqual(earthZako.filter((m) => upTo100(m).length === 2).map((m) => m.name).sort(), ['カゼコウセイ', 'ツギハクロ', 'ニドオチズ'].sort());
  assert.deepEqual(byName('カゼコウセイ').areas, ['はじまりの草原', '錬金術の工房']);
  assert.deepEqual(byName('ニドオチズ').areas, ['火山', '天空の神殿']);
  assert.deepEqual(byName('ツギハクロ').areas, ['夜の都会', '天空の神殿']);
  assert.deepEqual(byName('ヤクブソク').areas, ['平安京'], '言葉の俗説は平安京');
  assert.deepEqual(byName('キタヒロ').areas, ['氷の大地'], '北の土地の俗説は氷の大地');
});

test('冒険：ザコは今いる世界のエリアのものだけが群れで出る（世界が変わると出るザコも変わる）', () => {
  const ctx = makeCtx(seededRng(7));
  for (const st of earthStages) {
    for (const floor of [st.from, st.from + 3]) {
      const s = newGame();
      s.adventure.floor = floor;
      const pool = zakoPool(s, ctx);
      assert.ok(pool.length > 0, `${floor}階層`);
      for (const m of pool) assert.ok(m.areas.includes(st.name), `${floor}階層（${st.name}）に ${m.name}`);
      assert.deepEqual(pool.map((m) => m.id).sort(), earthZako.filter((m) => m.areas.includes(st.name)).map((m) => m.id).sort());
      for (let k = 0; k < 5; k++) {
        s.adventure.enemies = []; s.adventure.kills = 0;
        spawnGroup(s, ctx, []);
        for (const e of s.adventure.enemies) assert.ok(byName(e.name).areas.includes(st.name), `${floor}階層の群れに ${e.name}`);
      }
    }
  }
});

test('データ：101階層から先の世界には、100階層までの世界に出るザコが2つめの出現エリアとして出る（どの世界にも5体以上）', () => {
  for (const w of laterWorlds) {
    const list = earthZako.filter((m) => m.areas.includes(w));
    assert.ok(list.length >= 5, `${w} のザコ ${list.length}体`);
    for (const m of list) assert.equal(m.areas[1], w, `${m.name}：101階層から先の世界は2つめ`);
  }
  for (const m of earthZako) assert.ok(m.areas.filter((a) => laterWorlds.includes(a)).length <= 1, `${m.name} は101階層から先の世界には1つまで`);
  assert.deepEqual(byName('ワザトピサ').areas, ['夜の都会', '斜塔の町'], 'ピサの斜塔のザコは斜塔の町にも');
  assert.deepEqual(byName('モエテキエル').areas, ['錬金術の工房', '溶鉱炉の町'], '燃えると軽くなるのザコはフロギストンの世界にも');
});

test('冒険：最後の世界（201階層〜）より先も最後の世界のザコが出続ける', () => {
  const s = newGame();
  s.adventure.floor = 350;
  const pool = zakoPool(s, makeCtx());
  assert.ok(pool.length > 0);
  for (const m of pool) assert.ok(m.areas.includes(earthStages.at(-1).name), m.name);
});

test('冒険：今いる世界に出られるザコが1体もいなければ、地球のザコ全体から選ぶ', () => {
  const s = newGame();
  s.adventure.floor = 15;
  // 生き物の森のザコがいない（まだゲームに入っていない）とき
  const ctx = { ...makeCtx(), monsters: monsters.filter((m) => !(m.areas || []).includes('生き物の森')) };
  const pool = zakoPool(s, ctx);
  assert.equal(pool.length, ctx.monsters.filter((m) => m.kind === 'monster' && (m.world || 'earth') === 'earth').length);
  // 世界の一覧が無い ctx（エリアが分からない）でも、今までどおり地球のザコ全体
  const noStages = { ...makeCtx(), stages: undefined };
  assert.equal(zakoPool(s, noStages).length, earthZako.length);
});

test('月面は今のまま：月面のザコだけが出る（地球のエリアに関係しない）', () => {
  const s = newGame();
  s.adventure.world = 'moon';
  s.adventure.floor = 5;
  const pool = zakoPool(s, makeCtx());
  assert.ok(pool.length > 0);
  for (const m of pool) assert.equal(m.world, 'moon', m.name);
});

test('図鑑の「出現：◯◯」：世界の名前と階層の範囲（最後の世界は「◯階層〜」）', () => {
  assert.deepEqual(stageRange(earthStages[0], stages), [1, 10]);
  assert.deepEqual(stageRange(earthStages.find((s) => s.name === '天空の神殿'), stages), [91, 100]);
  assert.deepEqual(stageRange(earthStages.at(-1), stages), [201, null]);
  assert.deepEqual(areaLabels(byName('イチヤヅケ'), stages), ['はじまりの草原（1〜10階層）']);
  assert.deepEqual(areaLabels(byName('ニドオチズ'), stages), ['火山（51〜60階層）', '天空の神殿（91〜100階層）']);
  assert.deepEqual(areaLabels(byName('タダノリロン'), stages), ['錬金術の工房（31〜40階層）', '電波望遠鏡の高原（201〜階層）']);
  assert.deepEqual(areaLabels(byName('ジブンデヒカル'), stages), [], '月面のザコは areas を持たない');
});
