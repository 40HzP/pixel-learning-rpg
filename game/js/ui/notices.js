// 知らせ（少しの間出る文と、札）と、画面全体に重ねるもの（ミニムービー・孫の「なんで？」など）を1つずつ出す順番待ち。
// 2026-11-09 に main.js から分けた
import { el } from './dom.js';
import { SCENE_H } from '../render.js';
import * as facility from './facility.js';

/** app に結び付けた知らせの関数を作る（main.js の起動で1回だけ） */
export function createNotices(app) {
  const heldNotices = []; // ミニムービーなどを出している間に出た知らせ（終わってから出す）
  function notify(text, kind = '') {
    if (app.overlay) { heldNotices.push([text, kind]); return; }
    placeNotices();
    const box = document.getElementById('notices');
    const plain = [...box.children].filter((x) => !x.classList.contains('card'));
    if (plain.length && plain[plain.length - 1].textContent === text) return;
    const n = el('div', { class: 'notice ' + kind }, text);
    box.append(n);
    while (plain.length >= 2) plain.shift().remove(); // ふつうの知らせは2つまで（札は数えない）
    setTimeout(() => n.remove(), kind === 'bad' ? 6000 : 3500);
  }
  /**
   * 札の知らせ（あなたが信じていた誤解・図鑑の1体目・起動から3分の比較）。ふつうの知らせに押し出されず、ms 秒たつかタップで閉じる。
   * onTap を渡すとタップでそれをする（閉じたあとで）
   */
  function notifyCard(node, kind, ms, onTap = null) {
    if (app.overlay) { heldNotices.push([node, kind, ms, onTap]); return; }
    placeNotices();
    const box = document.getElementById('notices');
    const n = el('div', { class: `notice card ${kind}`, role: 'status' }, node);
    const close = () => n.remove();
    n.addEventListener('click', () => { close(); if (onTap) onTap(); });
    const cards = [...box.children].filter((x) => x.classList.contains('card'));
    while (cards.length >= 2) cards.shift().remove(); // 札は2枚まで（古いほうから閉じる）
    box.append(n);
    setTimeout(close, ms);
    return n;
  }

  /**
   * 画面全体に重ねるもの（ミニムービー・孫の「なんで？」）を1つずつ出す。出している間はゲームの時間が止まり、
   * 知らせは後回しになる。show は閉じると解決する Promise を返す関数
   */
  const overlays = [];
  function runOverlay(show) {
    overlays.push(show);
    if (app.overlay) return;
    app.overlay = true;
    (async () => {
      while (overlays.length) await overlays.shift()();
      app.overlay = false;
      for (const [text, kind, ms, onTap] of heldNotices.splice(0)) {
        if (typeof text === 'string') notify(text, kind);
        else notifyCard(text, kind, ms, onTap);
      }
    })();
  }

  /**
   * 知らせの位置：冒険では空と地面の間（山の辺り）、ほかの画面では上。解答ボタンやキャラクターに重ねない。
   * 冒険画面のステータスが長いとき（挑戦・逃げるボタンが出ているときなど）は、その下に出してボタンを隠さない。
   * 施設の中に入っているときは下に出す（上の「街へ」ボタンを隠さない）
   */
  function placeNotices() {
    const box = document.getElementById('notices');
    const cv = document.getElementById('scene');
    box.classList.toggle('bottom', app.tab === 'facility' && facility.insideFacility());
    if (app.tab === 'adventure' && cv.clientHeight) {
      const r = cv.getBoundingClientRect();
      const hud = document.getElementById('hud').getBoundingClientRect();
      box.style.top = Math.round(Math.max(r.top + r.height * (64 / SCENE_H), hud.bottom + 4)) + 'px';
    } else {
      box.style.top = '';
    }
  }

  return { notify, notifyCard, runOverlay, placeNotices };
}
