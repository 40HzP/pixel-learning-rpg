// 設定（下の切り替えバーの「設定」）。40HzP の依頼「設定でダークモードも選択出来るようにして」
// 今は画面の色（明るい色・ダーク）だけ。設定はセーブとは別に、この端末に覚えておく（localStorage の SETTINGS_KEY）。
// だから生まれ変わっても、セーブを消しても残る。
// 色そのものは css/style.css（:root が明るい色、:root[data-theme="dark"] がダーク）。
// index.html の先頭の小さなスクリプトも同じ名前（plrpg.settings）を読んで、読み込みの途中で色が一瞬変わらないようにしている
import { el } from './dom.js';

export const SETTINGS_KEY = 'plrpg.settings';
export const THEMES = [
  { id: 'light', name: '明るい色', desc: '紙のような明るい背景に濃い字' },
  { id: 'dark', name: 'ダーク', desc: '暗い背景に明るい字。夜や暗い所で目にやさしい' },
];
export const DEFAULT_THEME = 'light';
/** 図鑑の並べ方（図鑑の上のボタン。ui/zukan.js の zukanGroups）。最後に選んだものを覚える */
export const ZUKAN_SORTS = [
  { id: 'kind', name: '種類順' },
  { id: 'genre', name: 'ジャンル別' },
  { id: 'area', name: '出現エリア別' },
  { id: 'name', name: '名前順' },
];

/** 読んだ設定を整える（無い・知らない値は既定に） */
export function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    theme: THEMES.some((t) => t.id === s.theme) ? s.theme : DEFAULT_THEME,
    zukanSort: ZUKAN_SORTS.some((t) => t.id === s.zukanSort) ? s.zukanSort : ZUKAN_SORTS[0].id,
  };
}

export function loadSettings() {
  try { return normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch { return normalizeSettings(null); }
}

export function saveSettings(settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* 覚えられない環境でも、今は変わる */ }
}

/** 画面の色を変える（<html data-theme="dark">。明るい色は属性なし） */
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'dark') root.dataset.theme = 'dark';
  else delete root.dataset.theme;
}

let root = null;
let key = '';

export function init() {
  root = document.getElementById('screen-settings');
  root.classList.add('pad', 'settings');
}

export function update(app, force) {
  const now = app.settings.theme;
  if (!force && key === now) return;
  key = now;
  const pick = (id) => {
    app.settings = { ...app.settings, theme: id };
    saveSettings(app.settings);
    applyTheme(id);
    update(app, true);
  };
  root.replaceChildren(
    el('h2', {}, '設定'),
    el('div', { class: 'section' },
      el('h3', { class: 'subhead' }, '画面の色'),
      el('div', { class: 'theme-choices', role: 'radiogroup', 'aria-label': '画面の色' },
        THEMES.map((t) => el('button', {
          class: t.id === now ? 'on' : null, role: 'radio', 'aria-checked': t.id === now ? 'true' : 'false',
          'data-theme-choice': t.id, onclick: () => pick(t.id),
        },
        el('span', { class: `theme-sample ${t.id}` }, '勉強・図鑑', el('i', {}, '街の施設')),
        el('span', {}, t.name),
        el('small', {}, t.desc)))),
      el('p', { class: 'settings-note' }, '冒険画面の絵の上の字・街の絵・知らせ・ミニムービーは、どちらを選んでも暗い色のまま（ドット絵の上で読みやすいように）')),
  );
}
