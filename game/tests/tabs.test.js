import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('下の切り替えバーの「冒険」「勉強」「街」「図鑑」にアイコンがある（16×16・category icon のスプライト）', () => {
  const html = read('../index.html');
  const icons = Object.fromEntries([...html.matchAll(/data-tab="(\w+)" data-icon="(\w+)"/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual(Object.keys(icons), ['adventure', 'study', 'facility', 'zukan']);
  for (const [tab, name] of Object.entries(icons)) {
    const sp = JSON.parse(read(`../../pixel/sprites/${name}.json`));
    assert.deepEqual([sp.name, sp.category, sp.w, sp.h], [name, 'icon', 16, 16], `${tab} のアイコン ${name}`);
    assert.ok(sp.frames.length >= 1);
  }
});
