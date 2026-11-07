// 階層の移動（設計ページ「誕生日の熟練判定と階層の移動」）。冒険画面の「階層を移動」で開く。
// この人生で到達した階層（今いる世界）を、エリア（10階層ごと）に分けて並べる。エリアには図鑑の埋まり具合（まだ出会っていないザコの数）と、
// そのエリアのボスを出す。エリアを押すと階層のボタンが開き、押すとその階層の最初から始める（sim.js の floorAreas・moveToFloor）
import { floorAreas, reachedFloor, onMoon } from '../sim.js';
import { el } from './dom.js';

/** 開く。閉じると解決する Promise を返す（出している間はゲームの時間が止まる。main.js の runOverlay） */
export function openFloors(app) {
  return new Promise((resolve) => {
    const s = app.state;
    const moon = onMoon(s);
    const w = moon ? '月面' : '';
    const here = s.adventure.floor;
    const areas = floorAreas(s, app.ctx).reverse(); // 深いエリアを上に
    let open = areas.findIndex((a) => here >= a.from && here <= a.to);
    const list = el('div', { class: 'floor-areas' });
    const close = () => {
      overlay.classList.remove('show');
      setTimeout(() => { overlay.remove(); resolve(); }, 200);
    };
    const go = (floor) => {
      const r = app.moveFloor(floor);
      if (r.ok) close();
    };
    const render = () => list.replaceChildren(...areas.map((a, i) => {
      const isOpen = i === open;
      const zukan = a.unmet ? `まだ出会っていないザコ ${a.unmet}/${a.zako}体` : `ザコ ${a.zako}体と全部出会った`;
      const boss = a.boss ? `ボス：${a.boss.name}（${w}${a.boss.floor}階層・${a.boss.defeated ? '倒した。ザコが出る' : 'まだ倒していない'}）` : null;
      const head = el('button', {
        class: 'floor-area' + (isOpen ? ' open' : '') + (here >= a.from && here <= a.to ? ' here' : ''),
        'aria-expanded': isOpen ? 'true' : 'false',
        onclick: () => { open = isOpen ? -1 : i; render(); },
      },
      el('span', { class: 'name' }, a.name, el('small', {}, `${w}${a.from}〜${a.last}階層${a.last < a.to ? `（${a.to}階層まで）` : ''}`)),
      el('small', { class: a.unmet ? 'unmet' : 'done' }, zukan),
      boss ? el('small', {}, boss) : null);
      const floors = [];
      for (let f = a.from; f <= a.last; f++) {
        floors.push(el('button', {
          class: 'floor-btn' + (f === here ? ' here' : '') + (a.boss && a.boss.floor === f ? ' boss' : ''),
          disabled: f === here && !s.adventure.enemies.some((e) => e.kind === 'midboss'),
          'aria-label': `${w}${f}階層${f === here ? '（今いる）' : ''}`,
          onclick: () => go(f),
        }, String(f)));
      }
      return el('div', { class: 'floor-area-box' }, head, isOpen ? el('div', { class: 'floor-btns' }, floors) : null);
    }));
    render();
    const otherWorld = moon ? '地球の階層へは、月面の街の帰還ロケットで帰ってから'
      : s.life.moonMaxFloor ? '月面の階層へは、ロケット発射場から打ち上げてから' : null;
    const box = el('div', { class: 'dialog floors-box', role: 'dialog', 'aria-label': '階層を移動' },
      el('h2', {}, '階層を移動'),
      el('p', { class: 'muted' }, `この人生で到達した${w}階層（${w}1〜${reachedFloor(s)}階層）に移動できる。その階層の最初から始める。今は${w}${here}階層。`
        + 'やられたときは、1つ手前の階層の最初からやり直す'),
      otherWorld ? el('p', { class: 'muted' }, otherWorld) : null,
      list,
      el('div', { class: 'btnrow' }, el('button', { class: 'primary', onclick: close }, '閉じる')));
    const overlay = el('div', { class: 'overlay nande floors', onclick: (ev) => { if (ev.target === overlay) close(); } }, box);
    document.getElementById('app').append(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));
  });
}
