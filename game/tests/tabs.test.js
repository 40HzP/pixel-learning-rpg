import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('下の切り替えバーの「冒険」「勉強」「街」「図鑑」「設定」にアイコンがある（16×16・category icon のスプライト）', () => {
  const html = read('../index.html');
  const icons = Object.fromEntries([...html.matchAll(/data-tab="(\w+)" data-icon="(\w+)"/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual(Object.keys(icons), ['adventure', 'study', 'facility', 'zukan', 'settings']);
  for (const [tab, name] of Object.entries(icons)) {
    const sp = JSON.parse(read(`../../pixel/sprites/${name}.json`));
    assert.deepEqual([sp.name, sp.category, sp.w, sp.h], [name, 'icon', 16, 16], `${tab} のアイコン ${name}`);
    assert.ok(sp.frames.length >= 1);
  }
});

test('勉強のメニューのボタン（クイズ・テスト・過去問復習・補習・作問）にアイコンがある（study.js の MENU_LOOK）', () => {
  const src = read('../js/ui/study.js');
  const looks = [...src.matchAll(/(\w+): \{ icon: '(menu_\w+)', color: '(\w)' \}/g)].map((m) => ({ id: m[1], icon: m[2], color: m[3] }));
  assert.deepEqual(looks.map((x) => x.id), ['quiz', 'test', 'review', 'remedial', 'compose']);
  const palette = new Set(JSON.parse(read('../../pixel/palette.json')).colors.map((c) => c.key));
  for (const { id, icon, color } of looks) {
    const sp = JSON.parse(read(`../../pixel/sprites/${icon}.json`));
    assert.deepEqual([sp.name, sp.category, sp.w, sp.h], [icon, 'icon', 16, 16], `${id} のアイコン`);
    assert.ok(palette.has(color), `${id} の色はパレットのキー`);
  }
});

test('下の切り替えバーの木目：ui_tabs_wood（category texture）を2倍に敷き詰め、高さはバーの高さと同じ', () => {
  const sp = JSON.parse(read('../../pixel/sprites/ui_tabs_wood.json'));
  assert.deepEqual([sp.name, sp.category], ['ui_tabs_wood', 'texture']);
  const css = read('../css/style.css');
  const tabsH = Number(css.match(/--tabs-h:\s*(\d+)px/)[1]);
  assert.equal(sp.h * 2, tabsH, '2倍にするとバーの高さぴったり（板のすき間がずれない）');
  const palette = new Set(JSON.parse(read('../../pixel/palette.json')).colors.map((c) => c.key));
  for (const r of sp.frames[0]) {
    assert.equal(r.length, sp.w);
    for (const ch of r) assert.ok(palette.has(ch), '透明を使わない（下の地が透けない）');
  }
  assert.ok(read('../js/main.js').includes("load('ui_tabs_wood')"), 'main.js が読む');
});
