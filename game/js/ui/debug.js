// デバッグ画面（URL に ?debug=1 を付けたときだけ出る）
import { HOURS_PER_YEAR, genreState, spawnGroup, setHeroLevel, lifespanOf, ailmentAge, ageYears } from '../sim.js';
import { SAVE_KEY, serialize, deserialize } from '../save.js';
import { GENRES } from '../genres.js';
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
  const floor = el('input', { type: 'number', min: 1, value: 10, style: { width: '80px' } });
  const heroLevel = el('input', { type: 'number', min: 1, value: 10, style: { width: '80px' } });
  const changeLevel = (n) => {
    const lv = setHeroLevel(app.state, n, ctx);
    heroLevel.value = lv;
    app.notify(`${app.state.hero.name}を Lv ${lv} にした（HP・MP満タン）`);
  };
  const genre = el('select', {}, GENRES.map((g) => el('option', { value: g }, g)));
  // 熟練Lvの上限は生まれ変わるたびに上がるので、デバッグでは多めに選べるようにしておく
  const level = el('select', {}, Array.from({ length: 31 }, (_, i) => el('option', { value: i }, `Lv ${i}`)));
  const monster = el('select', {}, ctx.monsters.map((m) => el('option', { value: m.id }, m.name)));
  const text = el('textarea', { placeholder: 'ここにセーブの文字列が出ます／貼り付けて読み込めます' });

  root.replaceChildren(
    el('div', { class: 'section' }, el('h2', {}, '時間の速さ'), el('div', {}, speedButtons)),
    el('div', { class: 'section' }, el('h2', {}, 'ゴールド'),
      el('div', {}, el('button', { onclick: () => { app.state.gold += 1000; app.notify('ゴールド +1000'); } }, '+1000G'),
        el('button', { onclick: () => { app.state.gold += 1e11; app.notify('ゴールド +1000億'); } }, '+1000億G'))),
    el('div', { class: 'section' }, el('h2', {}, '主人公のレベル'),
      el('div', {}, 'Lv', heroLevel,
        el('button', { onclick: () => changeLevel(heroLevel.value) }, '設定'),
        el('button', { onclick: () => changeLevel(app.state.hero.level + 1) }, '+1'),
        el('button', { onclick: () => changeLevel(app.state.hero.level + 10) }, '+10'),
        el('button', { onclick: () => changeLevel(app.state.hero.level - 1) }, '−1'))),
    el('div', { class: 'section' }, el('h2', {}, '年齢'),
      el('div', {}, age, '歳', el('button', {
        onclick: () => {
          app.state.life.gameHours = Math.max(0, Number(age.value) || 0) * HOURS_PER_YEAR;
          if (app.state.meta.startAge == null) app.state.meta.startAge = 0;
          app.notify(`${age.value}歳にした`);
        },
      }, '設定'),
      el('button', {
        onclick: () => {
          app.state.life.ailing = false;
          app.state.life.gameHours = ailmentAge(app.state, ctx.balance) * HOURS_PER_YEAR - 24;
          app.notify('体の不調を感じ始める直前にした');
        },
      }, '体の不調の直前にする'),
      el('button', { onclick: () => { app.state.life.gameHours = lifespanOf(app.state, ctx.balance) * HOURS_PER_YEAR - 24; app.notify('寿命の直前にした'); } }, 'すぐ寿命にする'))),
    el('div', { class: 'section' }, el('h2', {}, '階層（小ボスの確認用）'),
      el('div', {}, floor, '階層', el('button', {
        onclick: () => {
          const adv = app.state.adventure;
          adv.floor = Math.max(1, Math.floor(Number(floor.value) || 1));
          adv.kills = 0;
          adv.enemies = [];
          adv.spawnTimer = 0;
          app.notify(`${adv.floor}階層にした`);
        },
      }, '移動'))),
    el('div', { class: 'section' }, el('h2', {}, '熟練'),
      el('div', {}, genre, level, el('button', {
        onclick: () => { genreState(app.state, genre.value).level = Number(level.value); app.notify(`${genre.value}を Lv ${level.value} にした`); },
      }, '設定')),
      el('div', {}, el('button', {
        onclick: () => {
          // 学際分野の2つのジャンルを、どちらも解放の条件（Lv3）以上にする。解放の知らせは次の tick で出る
          const need = ctx.balance.fields.unlockLevel;
          for (const f of ctx.fields.fields) for (const g of f.genres) { const st = genreState(app.state, g); st.level = Math.max(st.level, need); }
          app.notify(`学際分野のジャンルを全部 Lv${need} 以上にした`);
        },
      }, '学際分野を全部解放する'))),
    el('div', { class: 'section' }, el('h2', {}, '敵の群れを出す（選んだ魔物が先頭。干渉の確認用）'),
      el('div', {}, monster, el('button', {
        onclick: () => {
          const ev = [];
          const picked = ctx.monsters.find((m) => m.id === monster.value);
          const ids = [picked.id];
          if (picked.kind === 'monster') {
            const pool = ctx.monsters.filter((m) => m.kind === 'monster');
            const n = Math.max(1, ctx.balance.floor.monstersPerFloor - app.state.adventure.kills);
            while (ids.length < n) ids.push(pool[Math.floor(Math.random() * pool.length)].id);
          }
          spawnGroup(app.state, ctx, ev, ids);
          app.handleEvents(ev);
        },
      }, '出す'))),
    el('div', { class: 'section' }, el('h2', {}, 'ミニムービー（中ボスを倒したとき・体の不調）'),
      el('div', {}, ctx.monsters.filter((m) => m.defeatMovie).map((m) => el('button', { onclick: () => app.playMovie(m.id) }, m.name)),
        el('button', { onclick: () => app.playAilmentMovie(Math.max(ageYears(app.state), ailmentAge(app.state, ctx.balance))) }, '体の不調'))),
    el('div', { class: 'section' }, el('h2', {}, '睡眠'),
      el('div', {}, el('button', { onclick: () => app.sleepNow() }, 'すぐ眠る'))),
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
