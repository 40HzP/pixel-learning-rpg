import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeSettings, THEMES, DEFAULT_THEME, SETTINGS_KEY, ZUKAN_SORTS } from '../js/ui/settings.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('設定の画面の色：明るい色とダークを選べ、はじめ（と読めない値）は明るい色', () => {
  assert.deepEqual(THEMES.map((t) => t.id), ['light', 'dark']);
  assert.equal(DEFAULT_THEME, 'light');
  assert.equal(normalizeSettings(null).theme, 'light');
  assert.equal(normalizeSettings({}).theme, 'light');
  assert.equal(normalizeSettings({ theme: 'purple' }).theme, 'light');
  assert.equal(normalizeSettings({ theme: 'dark', other: 1 }).theme, 'dark');
  assert.ok(!('other' in normalizeSettings({ theme: 'dark', other: 1 })), '知らない項目は捨てる');
});

test('ダークの色は、明るい色で決めた色を全部決め直している（明るい色が残らない）', () => {
  const css = read('../css/style.css');
  const block = (sel) => {
    const i = css.indexOf(sel);
    assert.ok(i >= 0, `${sel} がある`);
    const body = css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
    return new Set([...body.matchAll(/(--[\w-]+):/g)].map((m) => m[1]));
  };
  const light = block(':root {');
  const dark = block(':root[data-theme="dark"]');
  for (const v of light) if (v !== '--tabs-h') assert.ok(dark.has(v), `ダークにも ${v} がある`);
});

test('index.html の先頭のスクリプトは、設定と同じ名前を読んでダークを先に当てる', () => {
  const html = read('../index.html');
  assert.ok(html.includes(`localStorage.getItem('${SETTINGS_KEY}')`), '同じ名前');
  assert.ok(html.indexOf("dataset.theme = 'dark'") < html.indexOf('<body>'), '<body> より前');
});

test('図鑑の並べ方：はじめ（と読めない値）は種類順。選んだものを覚える', () => {
  assert.deepEqual(ZUKAN_SORTS.map((s) => s.id), ['kind', 'genre', 'area', 'name']);
  assert.equal(normalizeSettings({}).zukanSort, 'kind');
  assert.equal(normalizeSettings({ zukanSort: 'random' }).zukanSort, 'kind');
  assert.equal(normalizeSettings({ zukanSort: 'genre', theme: 'dark' }).zukanSort, 'genre');
  assert.equal(normalizeSettings({ zukanSort: 'genre', theme: 'dark' }).theme, 'dark', '並べ方を覚えても画面の色は変わらない');
});
