// デバッグ画面（URL に ?debug=1 を付けたときだけ出る）
import { HOURS_PER_YEAR, genreState, spawnGroup, setHeroLevel, lifespanOf, ailmentAge, ageYears, zakoPool, rocketSteps, tameZako, worldOf } from '../sim.js';
import { SAVE_KEY, serialize, deserialize } from '../save.js';
import { GENRES } from '../genres.js';
import { refreshDaily, dayKey } from '../quiz.js';
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
  const dailyDate = el('input', { type: 'date', value: dayKey(new Date()), 'aria-label': '今日の1問の日付' });

  root.replaceChildren(
    el('div', { class: 'section' }, el('h2', {}, '時間の速さ'), el('div', {}, speedButtons)),
    el('div', { class: 'section' }, el('h2', {}, 'ゴールド'),
      el('div', {}, el('button', { onclick: () => { app.state.gold += 1000; app.notify('ゴールド +1000'); } }, '+1000G'),
        el('button', { onclick: () => { app.state.gold += 1e11; app.notify('ゴールド +1000億'); } }, '+1000億G'))),
    // 今日の1問：その日に初めて起動したときと同じにする（札がまた出る）。日付を選ぶと、その日の問題で試せる
    el('div', { class: 'section' }, el('h2', {}, '今日の1問'),
      el('div', {}, dailyDate,
        el('button', {
          onclick: () => {
            app.state.legacy.daily.day = null;
            app.debugDay = dailyDate.value && dailyDate.value !== dayKey(new Date()) ? dailyDate.value : null;
            refreshDaily(app.state, ctx, app.today());
            app.save();
            app.notify(`今日の1問をやり直す（${app.state.legacy.daily.day}）。冒険画面に札が出る`);
          },
        }, 'やり直す'))),
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
      el('button', { onclick: () => { app.state.life.gameHours = lifespanOf(app.state, ctx.balance) * HOURS_PER_YEAR - 24; app.notify('寿命の直前にした'); } }, 'すぐ寿命にする'),
      // 性別（ふだんは初回起動時と転生時に選ぶ）。女の子・男の子の絵を確かめる用
      el('button', {
        onclick: () => {
          app.state.hero.gender = app.state.hero.gender === 'female' ? 'male' : 'female';
          app.notify(`性別を${app.state.hero.gender === 'female' ? '女の子' : '男の子'}にした`);
        },
      }, '性別を切り替える'))),
    el('div', { class: 'section' }, el('h2', {}, '階層（ボスの確認用）'),
      el('div', {}, floor, '階層', el('button', {
        onclick: () => {
          const adv = app.state.adventure;
          adv.floor = Math.max(1, Math.floor(Number(floor.value) || 1));
          adv.kills = 0;
          adv.enemies = [];
          adv.spawnTimer = 0;
          app.notify(`${adv.world === 'moon' ? '月面' : ''}${adv.floor}階層にした`);
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
            const pool = zakoPool(app.state, ctx);
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
    el('div', { class: 'section' }, el('h2', {}, 'ロケットと月面'),
      el('div', {}, el('button', {
        onclick: () => {
          // 建造費を払い、すべての工程を終えたことにする（打ち上げはロケット発射場から）
          app.state.legacy.rocket.buildCostPaid = true;
          for (const st of rocketSteps(app.state, ctx)) app.state.legacy.rocket.steps[st.id] = st.need;
          app.notify('ロケットを完成させた（街のロケット発射場から打ち上げられる）');
        },
      }, 'ロケットを完成させる'),
      el('button', { onclick: () => app.launch() }, '打ち上げる'),
      el('button', { onclick: () => app.returnHome() }, '地球に帰る'),
      el('button', {
        onclick: () => {
          // 裏側の電波望遠鏡の「宇宙からの電波」を、あと1回の正解でいっぱいになるところまでためる（月面で正解すると頁が開く）
          app.state.knowledge.radio.charge = Math.max(0, ctx.balance.moon.radioCharge - 1);
          app.notify('宇宙からの電波をためた（月面で勉強に1問正解すると、図鑑の頁が開く）');
        },
      }, '宇宙からの電波をためる'))),
    el('div', { class: 'section' }, el('h2', {}, '飼育小屋と試作機'),
      el('div', {},
        el('button', {
          onclick: () => {
            // 今いる世界のザコを、まだ小屋にいないものから5体なつかせる（宇宙を飛んだ生き物のザコを先に）
            const world = app.state.adventure.world || 'earth';
            const left = ctx.monsters.filter((m) => m.kind === 'monster' && worldOf(m) === world && !app.state.legacy.barn.some((a) => a.id === m.id))
              .sort((a, b) => (b.space ? 1 : 0) - (a.space ? 1 : 0)).slice(0, 5);
            const ev = [];
            for (const m of left) tameZako(app.state, ctx, m.id, ev, true);
            app.notify(ev.length ? `${ev.map((e) => e.name).join('・')}が${ev[0].barn}に入った` : 'もう全部いる');
          },
        }, '今いる世界のザコを5体なつかせる'),
        el('button', {
          onclick: () => {
            app.state.legacy.rocket.steps.airframe = ctx.balance.rocket.stepYears * HOURS_PER_YEAR;
            app.state.gold = Math.max(app.state.gold, ctx.balance.rocket.prototype.cost * 20);
            app.notify('機体設計を終え、試作機20回分のゴールドを持たせた（ロケット発射場で試作機を飛ばせる）');
          },
        }, '機体設計を終える（試作機を飛ばせるように）'))),
    el('div', { class: 'section' }, el('h2', {}, '誕生日'),
      el('div', {}, el('button', { onclick: () => app.birthdayNow() }, '誕生日の判定を今する（全回復・熟練の判定）'))),
    el('div', { class: 'section' }, el('h2', {}, '最初の3分'),
      el('div', {},
        el('button', { onclick: () => app.playPrologue() }, '前世の最期を流す'),
        el('button', { onclick: () => app.playRebirthScene() }, '生まれ変わりの場面を流す（今の人生の熟練の記録で）'),
        el('button', { onclick: () => app.restartFirstCheck() }, '前世の記憶をたどり直す'),
        el('button', { onclick: () => app.launchCompareNow() }, '起動から3分の比較を今出す'))),
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
