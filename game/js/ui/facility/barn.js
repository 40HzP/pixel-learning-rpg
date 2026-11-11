// 飼育小屋（月面の飼育ドームも同じ画面）：なついたザコが部屋の中を歩き回り、触ると懐き度と誤解・本当のことが見られる。
// 部屋分けと部屋の背景（設計ページ「部屋分け（2026-11-11）」「部屋の背景」）：部屋を切り替え、ザコを選んで「この部屋へ」で移し、
// 部屋の名前と背景を選ぶ。2026-11-09 に ui/facility.js から分けた
import {
  rocketSteps, barnAnimals, barnCapacity, BARN_NAMES, joinChance, affinityRate, touchZako, isReformed,
  barnRoomList, barnRoomInfo, moveToRoom, renameBarnRoom, setRoomBackground, barnBackgrounds, ROOM_NAME_MAX,
} from '../../sim.js';
import { fieldActive } from '../../fields.js';
import { drawSprite, drawPlaceholder, frameAt, spriteCanvas, cssColor, drawHalo } from '../../sprites.js';
import { el, affNum } from '../dom.js';
import { root, view, say, update, note, pct } from './common.js';

const BARN_W = 90;
const BARN_H = 64;
const BARN_SHOW = 12; // 1つの部屋の中を歩くザコの数（部屋に入った順に新しいほうから。ほかは下の一覧から見る）
let barnPick = null; // 小屋で最後に触ったザコ（{ view, id }。階層が進むなどで画面を作り直しても、札を出したままにする）
const roomPick = { earth: 0, moon: 0 }; // 見ている部屋（世界ごと）
let settingsOpen = false; // 「部屋の名前と背景」を開いているか（作り直しても開いたまま）

/**
 * 小屋のザコの札：懐き度（帯）・触った結果・そのザコの一言（誤解。更生すると本当のこと）・「誤解」と「本当のこと」
 * （言葉のザコは「よく言われる意味」と「本来の意味」、研究が割れているザコは「研究が割れている」）。touch は触った結果（touchZako）
 */
function barnCard(app, a, touch) {
  const m = a.monster;
  const b = app.ctx.balance.barn;
  const aff = Math.floor(a.affinity || 0);
  const reformed = aff >= b.affinityMax;
  const mythLabel = m.mythLabel || (m.wordType ? 'よく言われる意味' : '誤解');
  const truthLabel = m.wordType ? '本来の意味' : '本当のこと';
  const flights = a.flights ? `試作機で${a.flights}回飛んで帰ってきた` : '';
  const bar = el('i', { style: { width: `${(aff / b.affinityMax) * 100}%` } });
  const touchText = !touch ? '' : touch.already ? '今日はもうなでた（1日に1回、懐き度が上がる）'
    : touch.gained > 0 ? `なでた！　懐き度 +${affNum(touch.gained)}` : 'なでた！';
  const perks = reformed ? '更生した：誤解ではなく本当のことを話すようになった'
    : aff >= b.friendlyAffinity ? `懐いている：誕生日に贈り物を持ってくることがあり、${m.name}の問題で誤答を1つ消してくれる`
      : `懐き度${b.friendlyAffinity}で、誕生日の贈り物と勉強の手伝い。${b.affinityMax}で更生する`;
  return [
    el('div', { class: 'barn-card-head' },
      spriteCanvas((app.monsterSprites[m.id] || {}).idle, 3, app.palette, { halo: reformed }),
      el('div', {}, el('b', {}, m.name), a.space ? el('span', { class: 'space-badge' }, '宇宙帰り') : null,
        reformed ? el('span', { class: 'space-badge reformed' }, '更生') : null, flights ? el('small', {}, flights) : null)),
    el('div', { class: 'affinity' }, el('span', {}, '懐き度'), el('div', { class: 'affbar' }, bar), el('b', {}, `${aff}/${b.affinityMax}`)),
    touchText ? el('div', { class: touch && touch.gained > 0 ? 'good' : 'muted' }, touchText) : null,
    el('small', { class: 'muted' }, perks),
    // そのザコの一言：誤解を話す。更生すると本当のことを話す（設計ページ「懐き度」の⑤）
    el('div', { class: 'barn-say' + (reformed ? ' reformed' : '') }, `「${reformed ? (m.debated ? '本当のところは、研究が割れているんだ' : m.truth) : m.myth}」`),
    el('span', { class: 'label' }, mythLabel), el('div', {}, m.myth),
    el('span', { class: 'label' }, truthLabel), el('div', { class: 'good' }, m.debated ? '研究が割れている' : m.truth),
    a.space && m.space && m.space.history ? el('div', { class: 'muted barn-history' }, m.space.history) : null,
  ].filter(Boolean);
}

/** 部屋の背景の絵：生態展示は10階層ごとの世界の背景（stages.json）、ほかは town.json の barnRooms に書いた絵 */
function roomSprite(app, bg) {
  if (!bg) return null;
  if (bg.area) return (app.stages.find((st) => !st.world && st.name === bg.area) || {}).bg || null;
  return app.roomSprites[bg.id] || null;
}

/** 部屋の名前と背景を変える欄（開け閉めできる） */
function roomSettings(app, world, cur) {
  const nameInput = el('input', { type: 'text', value: cur.name, maxLength: ROOM_NAME_MAX, autocomplete: 'off', 'aria-label': '部屋の名前' });
  const rename = () => {
    const name = renameBarnRoom(app.state, world, cur.index, nameInput.value);
    if (name == null) return;
    app.save();
    say(app, `部屋の名前を「${name}」にした`, 'good');
    update(app, true);
  };
  // 背景は、いつもの・生態展示（10のエリア）・そのほかの展示に分けて並べる
  const all = barnBackgrounds(app.ctx);
  const groups = [
    ['いつもの', all.filter((b) => !b.area && /^いつもの/.test(b.name))],
    ['生態展示（10のエリア）', all.filter((b) => b.area)],
    ['ほかの展示', all.filter((b) => !b.area && !/^いつもの/.test(b.name))],
  ];
  const select = el('select', {
    'aria-label': '部屋の背景',
    onchange: () => {
      const r = setRoomBackground(app.state, app.ctx, world, cur.index, select.value);
      if (!r.ok) { say(app, r.reason, 'bad'); return; }
      app.save();
      say(app, `${cur.name}の背景を「${r.name}」にした`, 'good');
      update(app, true);
    },
  }, groups.map(([label, list]) => el('optgroup', { label }, list.map((b) => el('option', { value: b.id }, b.area ? b.area : b.name)))));
  select.value = cur.bg ? cur.bg.id : '';
  const d = el('details', { class: 'barn-room-set', open: settingsOpen, ontoggle: () => { settingsOpen = d.open; } },
    el('summary', {}, '部屋の名前と背景'),
    el('div', { class: 'rename' }, nameInput, el('button', { onclick: rename }, '名前を変える')),
    el('div', { class: 'barn-bg-pick' }, el('span', {}, '背景'), select),
    cur.bg ? el('small', { class: 'muted' }, `${cur.bg.group || cur.bg.name}：${cur.bg.note}`) : null,
    el('small', { class: 'muted' }, '部屋や背景による効果は無い。好きなように並べて眺める'));
  return d;
}

/**
 * 飼育小屋（地球のザコ）と月面の飼育ドーム（月面のザコ）。なついたザコが部屋の中を歩き回り、触ると誤解と本当のことが見られる。
 * 部屋が2つ以上あれば上で部屋を切り替える。下にいるザコの一覧（部屋ごと。押しても同じ札が出て、ほかの部屋のザコは「この部屋へ」で移せる）
 */
export function barnPanel(app) {
  const s = app.state;
  const ctx = app.ctx;
  const world = view === 'moon_barn' ? 'moon' : 'earth';
  const other = world === 'moon' ? 'earth' : 'moon';
  const animals = barnAnimals(s, ctx, world);
  const elsewhere = barnAnimals(s, ctx, other).length;
  const rooms = barnRoomList(s, ctx, world);
  if (!(roomPick[world] < rooms.length)) roomPick[world] = 0;
  const cur = rooms[roomPick[world]];
  const info = barnRoomInfo(s, ctx, world);
  const many = rooms.length > 1;
  const canvas = el('canvas', { class: 'pixel barn-scene', width: BARN_W, height: BARN_H, 'aria-label': `${BARN_NAMES[world]}の${cur.name}の中` });
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  const hint = !animals.length ? ''
    : cur.animals.length ? 'ザコを触ると、懐き度と、誤解と本当のことが見られる（1日に1回、なでると懐き度が上がる）'
      : `${cur.name}にはまだ誰もいない。下の一覧からザコを選んで「この部屋へ」で移せる`;
  const card = el('div', { class: 'barn-card', 'aria-live': 'polite' }, el('div', { class: 'muted' }, hint));
  // ザコが歩ける床（ザコの絵の左上。足元が床に乗るように。床の上の端は背景ごと：town.json の floorY）
  const area = { x0: 0, x1: BARN_W - 16, y0: cur.bg ? cur.bg.floorY : 15, y1: BARN_H - 17 };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const walkers = cur.animals.slice(-BARN_SHOW).map((a) => {
    const x = rnd(area.x0, area.x1), y = rnd(area.y0, area.y1);
    return { a, sp: (app.monsterSprites[a.id] || {}).idle, x, y, tx: x, ty: y, wait: rnd(0, 2), flip: Math.random() < 0.5, speed: rnd(5, 9), reformed: isReformed(s, ctx, a.id) };
  });
  const barn = { canvas, g, walkers, world, area, bg: cur.bg, sprite: roomSprite(app, cur.bg), selected: null, last: 0 };
  // ほかの部屋のザコを、見ている部屋へ移す
  const move = (id) => {
    const r = moveToRoom(app.state, ctx, id, cur.index);
    if (!r.ok) { say(app, r.reason, 'bad'); return; }
    app.save();
    say(app, `${r.name}を${r.room}に移した`, 'good');
    update(app, true);
  };
  // 札の下の「いる部屋」と「この部屋へ」（部屋が2つ以上のとき）
  const roomRow = (a) => {
    if (!many) return null;
    const where = rooms[a.room] ? rooms[a.room].name : rooms[0].name;
    return a.room === cur.index
      ? el('div', { class: 'barn-room-row muted' }, `いる部屋：${where}（この部屋）`)
      : el('div', { class: 'barn-room-row' }, el('span', {}, `いる部屋：${where}`),
        el('button', { class: 'primary', onclick: () => move(a.id) }, `この部屋（${cur.name}）へ`));
  };
  // 触る（なでる）：そのザコは1日に1回、懐き度が上がる。懐いた・更生したときは知らせが出る
  const show = (id, touch) => {
    barn.selected = id;
    const a = barnAnimals(app.state, app.ctx, world).find((x) => x.id === id);
    if (a) card.replaceChildren(...barnCard(app, a, touch), ...[roomRow(a)].filter(Boolean));
    for (const b of list.querySelectorAll('button[data-id]')) b.classList.toggle('on', b.dataset.id === id);
  };
  const select = (id) => {
    barnPick = { view, id };
    const ev = [];
    const touch = touchZako(app.state, app.ctx, id, app.today(), ev);
    if (touch.gained > 0) app.save();
    if (ev.length) app.handleEvents(ev);
    show(id, touch);
    const w = walkers.find((x) => x.a.id === id);
    if (w) w.reformed = isReformed(app.state, app.ctx, id);
  };
  canvas.addEventListener('click', (ev) => {
    const r = canvas.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * BARN_W, py = ((ev.clientY - r.top) / r.height) * BARN_H;
    // 手前（足元が下）のザコから。指でも押しやすいように少し広めに
    const hit = [...walkers].sort((p, q) => q.y - p.y).find((w) => px >= w.x - 2 && px <= w.x + 18 && py >= w.y - 2 && py <= w.y + 18);
    if (hit) select(hit.a.id);
  });
  const zakoButton = (a) => el('button', { 'data-id': a.id, onclick: () => select(a.id) },
    spriteCanvas((app.monsterSprites[a.id] || {}).idle, 2, app.palette, { halo: isReformed(s, ctx, a.id) }),
    el('span', {}, a.monster.name, el('small', {}, `懐き度 ${Math.floor(a.affinity || 0)}`)),
    a.space ? el('span', { class: 'space-badge' }, '宇宙') : null);
  // 一覧：部屋ごと（部屋が1つなら見出しなし）。見ている部屋を先に
  const order = [cur, ...rooms.filter((r) => r !== cur)].filter((r) => r.animals.length);
  const list = el('div', { class: 'barn-groups' }, order.map((r) => el('div', { class: 'barn-group' + (r === cur ? ' here' : '') },
    many ? el('div', { class: 'barn-group-name' }, r === cur ? `この部屋（${r.name}）` : r.name, el('small', {}, `${r.animals.length}体`)) : null,
    el('div', { class: 'barn-list' }, r.animals.map(zakoButton)))));
  // 作り直したときは、前に触ったザコの札を出したままにする（触ったことにはしない）
  if (barnPick && barnPick.view === view && animals.some((a) => a.id === barnPick.id)) show(barnPick.id, null);
  // 歩くザコは画面の更新（0.2秒ごと）より細かく動かす。施設を出て絵が外れたら止まる
  const loop = () => {
    if (!canvas.isConnected) return;
    if (!root.hidden) drawBarn(app, barn, performance.now() / 1000);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  const frameDone = rocketSteps(s, ctx).some((st) => st.id === 'airframe' && st.done);
  const roomsText = `部屋 ${info.built}／${info.max}`
    + (info.nextLevel != null ? `（${info.genre}の熟練がLv${info.nextLevel}になると部屋が増える。今 Lv${info.level}）` : '');
  return [
    el('div', { class: 'profit' }, `${animals.length}体 ／ ${barnCapacity(ctx, world)}体`,
      el('small', { class: 'muted' }, world === 'moon' ? '（月面のザコ）' : '（地球のザコ）')),
    el('small', { class: 'muted barn-rooms-count' }, roomsText),
    many ? el('div', { class: 'barn-rooms' }, rooms.map((r) => el('button', {
      class: r === cur ? 'on' : '', 'aria-pressed': r === cur ? 'true' : 'false',
      onclick: () => { roomPick[world] = r.index; update(app, true); },
    }, el('span', {}, r.name), el('small', {}, `${r.animals.length}体`)))) : null,
    el('div', { class: 'barn-room-head' }, el('b', {}, cur.name), cur.home ? el('span', { class: 'space-badge home' }, 'ふるさと') : null,
      el('small', { class: 'muted' }, cur.bg ? cur.bg.name : '')),
    el('div', { class: 'barn-box' }, canvas),
    card,
    roomSettings(app, world, cur),
    cur.home ? note(`${cur.home}に出るザコだけが集まった「ふるさと」の部屋`) : null,
    cur.animals.length > BARN_SHOW ? note(`この部屋を歩いているのは新しく入った${BARN_SHOW}体。ほかのザコは下の一覧から見られる`) : null,
    animals.length ? list : note(`まだ誰もいない。${world === 'moon' ? '月面の' : ''}ザコを倒すと、ときどきなついて、ここ（広間）に入る`),
    elsewhere ? note(world === 'earth' ? `月面の飼育ドームにも${elsewhere}体いる（月面の街で見られる）` : `地球の飼育小屋にも${elsewhere}体いる（地球の街で見られる）`) : null,
    // 動物行動学（学際分野）を専攻にしていると、なつきやすく、懐き度も上がりやすい
    fieldActive(s, ctx, 'ethology')
      ? el('div', { class: 'good' }, `動物行動学：ザコがなつく確率 ${pct(joinChance(s, ctx))}・懐き度の上がり方 ${affinityRate(s, ctx)}倍`)
      : null,
    note(frameDone ? 'ロケット発射場で、小屋のザコ（飼育ドームのザコも）を試作機に乗せて飛ばせる' : 'ロケット計画の「機体設計」が終わると、ロケット発射場で小屋のザコを試作機に乗せて飛ばせる'),
  ];
}

/** 部屋の中のザコを歩かせて描く（毎フレーム）。生態展示の背景は、階層の背景（90×160）の crop 行目から下を見せる */
function drawBarn(app, barn, now) {
  const dt = barn.last ? Math.min(0.1, now - barn.last) : 0;
  barn.last = now;
  const { g, area } = barn;
  g.clearRect(0, 0, BARN_W, BARN_H);
  if (barn.sprite) drawSprite(g, barn.sprite, 0, 0, -((barn.bg && barn.bg.crop) || 0));
  else drawPlaceholder(g, 0, 0, BARN_W, BARN_H, app.palette);
  for (const w of barn.walkers) {
    if (w.wait > 0) w.wait -= dt;
    else {
      const dx = w.tx - w.x, dy = w.ty - w.y, d = Math.hypot(dx, dy);
      if (d < 0.5) {
        // 着いたら少し休んで、次の行き先を決める
        w.wait = 0.5 + Math.random() * 2.5;
        w.tx = area.x0 + Math.random() * (area.x1 - area.x0);
        w.ty = area.y0 + Math.random() * (area.y1 - area.y0);
        w.flip = w.tx > w.x; // 魔物の絵は左向き。右へ行くときは裏返す
      } else {
        const step = Math.min(d, w.speed * dt);
        w.x += (dx / d) * step; w.y += (dy / d) * step;
      }
    }
  }
  for (const w of [...barn.walkers].sort((p, q) => p.y - q.y)) {
    if (w.sp) drawSprite(g, w.sp, frameAt(w.sp, now), w.x, w.y, { flip: w.flip });
    else drawPlaceholder(g, w.x, w.y, 16, 16, app.palette);
    if (w.reformed && w.sp) drawHalo(g, w.sp, w.x, w.y, app.palette, { flip: w.flip }); // 更生した印（光の輪）
    if (w.a.id === barn.selected) {
      // 選んだザコの頭の上に小さな黄色い矢印
      g.fillStyle = cssColor(app.palette, 'g', '#fbe57a');
      const cx = Math.round(w.x) + 7, top = Math.round(w.y) - (w.reformed ? 9 : 4); // 光の輪があれば、その上に
      g.fillRect(cx - 1, top, 4, 1); g.fillRect(cx, top + 1, 2, 1);
    }
  }
}
