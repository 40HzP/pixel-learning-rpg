import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { zukanGroups } from '../js/ui/zukan.js';
import { ZUKAN_SORTS } from '../js/ui/settings.js';
import { stageFor } from '../js/sim.js';
import { monsters, stages } from './helpers.js';

const genreGroups = JSON.parse(readFileSync(fileURLToPath(new URL('../data/genre-groups.json', import.meta.url)), 'utf8')).groups;
const ids = (groups) => groups.flatMap((g) => g.items.map((m) => m.id));

test('図鑑の並べ方：どの並べ方でも、魔物は全部1回ずつ出て、空のまとまりは無い', () => {
  for (const { id } of ZUKAN_SORTS) {
    const groups = zukanGroups(monsters, id, { genreGroups, stages, zukan: {} });
    const all = ids(groups);
    assert.equal(all.length, monsters.length, id);
    assert.equal(new Set(all).size, monsters.length, `${id}：重ならない`);
    assert.ok(groups.every((g) => g.items.length > 0 && g.title), `${id}：見出しがあり、空でない`);
  }
});

test('種類順は今までの並び（地球のザコ・月面のザコ・ボス・中ボス）', () => {
  const groups = zukanGroups(monsters, 'kind', { genreGroups, stages });
  assert.deepEqual(ids(groups), monsters.map((m) => m.id));
  assert.equal(groups.at(-1).title, '中ボス（専門職の人）');
});

test('ジャンル別：最初のジャンルで分け、並びと色はテストのジャンル選びと同じ。中ボスは最後', () => {
  const groups = zukanGroups(monsters, 'genre', { genreGroups, stages });
  const order = genreGroups.flatMap((g) => g.genres.map((x) => x.name));
  const genreHeads = groups.filter((g) => g.color);
  assert.deepEqual(genreHeads.map((g) => g.title), order.filter((n) => genreHeads.some((g) => g.title === n)), '並びはまとまりの順');
  for (const g of genreHeads) {
    assert.ok(g.items.every((m) => m.genres[0] === g.title), `${g.title}：最初のジャンルが同じ魔物だけ`);
    assert.equal(g.color, genreGroups.find((gg) => gg.genres.some((x) => x.name === g.title)).color);
  }
  assert.ok(!groups.some((g) => g.title === 'そのほか'), 'どの魔物もジャンルのどれかに入る');
  assert.ok(groups.at(-1).items.every((m) => m.kind === 'midboss'));
});

test('出現エリア別：ザコは最初の出現エリア、ボスはいる階層の世界。そのあと月面、中ボス', () => {
  const groups = zukanGroups(monsters, 'area', { genreGroups, stages });
  const earth = stages.filter((s) => (s.world || 'earth') === 'earth');
  for (const st of earth) {
    const g = groups.find((x) => x.title.startsWith(st.name + '（'));
    assert.ok(g, `${st.name} の見出し`);
    for (const m of g.items) {
      if (m.kind === 'monster') assert.equal(m.areas[0], st.name);
      else assert.equal(stageFor(m.floor, stages, 'earth'), st, `${m.name} はその世界の階層にいるボス`);
    }
  }
  assert.deepEqual(groups.slice(-2).map((g) => g.title), ['月面', '中ボス（専門職の人）']);
  assert.ok(groups.find((g) => g.title === '月面').items.every((m) => m.world === 'moon'));
  assert.ok(groups.find((g) => g.title.startsWith('はじまりの草原')).title.includes('（1〜10階層）'));
});

test('名前順：出会った魔物はあいうえお順、まだ出会っていない魔物は最後（名前は分からないので元の並び）', () => {
  const zukan = Object.fromEntries(monsters.slice(0, 30).map((m) => [m.id, { stage: 1 }]));
  const groups = zukanGroups(monsters, 'name', { genreGroups, stages, zukan });
  assert.equal(groups.length, 2);
  const names = groups[0].items.map((m) => m.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'ja')));
  assert.equal(groups[0].items.length, 30);
  assert.deepEqual(groups[1].items.map((m) => m.id), monsters.slice(30).map((m) => m.id));
});
