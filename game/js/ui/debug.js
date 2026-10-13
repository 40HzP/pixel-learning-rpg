// デバッグ画面（URL に ?debug=1 を付けたときだけ出る）
import { HOURS_PER_YEAR, genreState, spawnEnemy } from '../sim.js';
import { SAVE_KEY, serialize, deserialize } from '../save.js';
import { GENRES, MAX_PROFICIENCY } from '../genres.js';
import { el } from './dom.js';

let root = null;
let speedButtons = [];

export function init(app) {
  root = document.getElementById('screen-debug');
  if (!app.debug) return;
  root.classList.add('pad', 'debug');
  const ctx = app.ctx;

  speedButtons = [1, 60, 600].map((v) => el('button', { onclick: () => { app.speed = v; update(app); } }, `×${v}`));
  const age = el('input', { type: 'number', min: 0, max: 100, value: 7, style: { width: '80px' } });
  const genre = el('select', {}, GENRES.map((g) => el('option', { value: g }, g)));
  const level = el('select', {}, Array.from({ length: MAX_PROFICIENCY + 1 }, (_, i) => el('option', { value: i }, `Lv ${i}`)));
  const monster = el('select', {}, ctx.monsters.map((m) => el('option', { value: m.id }, m.name)));
  const text = el('textarea', { placeholder: 'ここにセーブの文字列が出ます／貼り付けて読み込めます' });

  root.replaceChildren(
    el('div', { class: 'section' }, el('h2', {}, '時間の速さ'), el('div', {}, speedButtons)),
    el('div', { class: 'section' }, el('h2', {}, 'ゴールド'),
      el('div', {}, el('button', { onclick: () => { app.state.gold += 1000; app.notify('ゴールド +1000'); } }, '+1000G'))),
    el('div', { class: 'section' }, el('h2', {}, '年齢'),
      el('div', {}, age, '歳', el('button', {
        onclick: () => {
          app.state.life.gameHours = Math.max(0, Number(age.value) || 0) * HOURS_PER_YEAR;
          if (app.state.meta.startAge == null) app.state.meta.startAge = 0;
          app.notify(`${age.value}歳にした`);
        },
      }, '設定'))),
    el('div', { class: 'section' }, el('h2', {}, '熟練'),
      el('div', {}, genre, level, el('button', {
        onclick: () => { genreState(app.state, genre.value).level = Number(level.value); app.notify(`${genre.value}を Lv ${level.value} にした`); },
      }, '設定'))),
    el('div', { class: 'section' }, el('h2', {}, '敵を出す（干渉の確認用）'),
      el('div', {}, monster, el('button', {
        onclick: () => {
          const ev = [];
          spawnEnemy(app.state, ctx, ev, monster.value);
          app.handleEvents(ev);
        },
      }, '出す'))),
    el('div', { class: 'section' }, el('h2', {}, '睡眠'),
      el('div', {}, el('button', { onclick: () => app.sleepNow('bed') }, 'すぐ眠る'))),
    el('div', { class: 'section' }, el('h2', {}, 'セーブ'),
      el('div', {},
        el('button', { onclick: () => { text.value = serialize(app.state, Date.now()); } }, '文字列で書き出す'),
        el('button', {
          onclick: () => {
            try {
              app.replaceState(deserialize(text.value, ctx.balance));
              app.save();
              app.notify('読み込んだ', 'good');
            } catch (e) { app.notify('読み込めませんでした：' + e.message, 'bad'); }
          },
        }, '読み込む'),
        el('button', {
          onclick: () => {
            if (!confirm('セーブを消して最初からやり直しますか？')) return;
            app.noSave = true;
            try { localStorage.removeItem(SAVE_KEY); } catch { /* 無視 */ }
            location.reload();
          },
        }, 'セーブを消す')),
      text),
  );
  update(app);
}

export function update(app) {
  for (const b of speedButtons) b.classList.toggle('on', b.textContent === `×${app.speed}`);
}
