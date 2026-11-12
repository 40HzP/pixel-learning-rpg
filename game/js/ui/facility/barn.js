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
import { root, view, live, say, update, note, pct } from './common.js';

const BARN_W = 90;
const BARN_H = 64;
const BARN_SHOW = 12; // 1つの部屋の中を歩くザコの数（部屋に入った順に新しいほうから。ほかは下の一覧から見る）
let barnPick = null; // 小屋で最後に触ったザコ（{ view, id }。階層が進むなどで画面を作り直しても、札を出したままにする）
const roomPick = { earth: 0, moon: 0 }; // 見ている部屋（世界ごと）
let settingsOpen = false; // 「部屋の名前と背景」を開いているか（作り直しても開いたまま）

/** なでた行の文（いつも1行置いて、なでる前とあとで札の大きさが変わらないようにする） */
const TOUCH_TEXT = {
  gained: (n) => `なでた！　懐き度 +${affNum(n)}`,
  touched: 'なでた！',
  already: '今日はもうなでた（懐き度が上がるのは1日1回）',
  ready: 'なでると懐き度が上がる（1日1回）',
};
let lastTouch = null; // 最後になでた結果 { id, day, touch }（画面を作り直しても、なでた行をそのまま出すため）

/**
 * 小屋のザコの札：懐き度（帯）・なでた行・そのザコの一言（誤解。更生すると本当のこと）・「誤解」と「本当のこと」
 * （言葉のザコは「よく言われる意味」と「本来の意味」、研究が割れているザコは「研究が割れている」）。touch は触った結果（touchZako）。
 * worst は札の高さを測るための形：変わりうる文をいちばん長いものにして測る（fitCard）
 */
function barnCard(app, a, touch, worst = false) {
  const m = a.monster;
  const b = app.ctx.balance.barn;
  const aff = Math.floor(a.affinity || 0);
  const reformed = aff >= b.affinityMax;
  const mythLabel = m.mythLabel || (m.wordType ? 'よく言われる意味' : '誤解');
  const truthLabel = m.wordType ? '本来の意味' : '本当のこと';
  const flights = a.flights ? `試作機で${a.flights}回飛んで帰ってきた` : '';
  const bar = el('i', { style: { width: `${(aff / b.affinityMax) * 100}%` } });
  const today = app.today();
  const touchText = worst ? TOUCH_TEXT.already
    : touch ? (touch.already ? TOUCH_TEXT.already : touch.gained > 0 ? TOUCH_TEXT.gained(touch.gained) : TOUCH_TEXT.touched)
      : a.touchedOn === today ? TOUCH_TEXT.already : TOUCH_TEXT.ready;
  const perkTexts = [
    '更生した：誤解ではなく本当のことを話すようになった',
    `懐いている：誕生日に贈り物を持ってくることがあり、${m.name}の問題で誤答を1つ消してくれる`,
    `懐き度${b.friendlyAffinity}で、誕生日の贈り物と勉強の手伝い。${b.affinityMax}で更生する`,
  ];
  const perks = worst ? perkTexts.reduce((x, y) => (y.length > x.length ? y : x))
    : perkTexts[reformed ? 0 : aff >= b.friendlyAffinity ? 1 : 2];
  const truthSay = m.debated ? '本当のところは、研究が割れているんだ' : m.truth;
  const say = worst ? (truthSay.length > m.myth.length ? truthSay : m.myth) : reformed ? truthSay : m.myth;
  return [
    el('div', { class: 'barn-card-head' },
      spriteCanvas((app.monsterSprites[m.id] || {}).idle, 3, app.palette, { halo: reformed || worst }),
      el('div', {}, el('b', {}, m.name), a.space ? el('span', { class: 'space-badge' }, '宇宙帰り') : null,
        reformed || worst ? el('span', { class: 'space-badge reformed' }, '更生') : null, flights ? el('small', {}, flights) : null)),
    el('div', { class: 'affinity' }, el('span', {}, '懐き度'), el('div', { class: 'affbar' }, bar), el('b', {}, `${aff}/${b.affinityMax}`)),
    el('div', { class: 'barn-touch ' + (touch && touch.gained > 0 ? 'good' : 'muted') }, touchText),
    el('small', { class: 'muted' }, perks),
    // そのザコの一言：誤解を話す。更生すると本当のことを話す（設計ページ「懐き度」の⑤）
    el('div', { class: 'barn-say' + (reformed ? ' reformed' : '') }, `「${say}」`),
    el('span', { class: 'label' }, mythLabel), el('div', {}, m.myth),
    el('span', { class: 'label' }, truthLabel), el('div', { class: 'good' }, m.debated ? '研究が割れている' : m.truth),
    a.space && m.space && m.space.history ? el('div', { class: 'muted barn-history' }, m.space.history) : null,
  ].filter(Boolean);
}

/**
 * 札の高さをそろえる（40HzP の依頼「ザコによって説明文の長さが違って枠のサイズが統一されてない」）。
 * その世界の小屋のザコ全員の札を、変わりうる文をいちばん長くした形（barnCard の worst）で画面の外に並べて測り、
 * いちばん高い札の高さを札の最低の高さにする。札の大きさが変わらないので、なでても・ほかのザコを選んでも、下の一覧が動かない
 * （前は札が伸びて一覧が下へずれ、スクロールした位置から飛んだように見えた）。
 * 測った高さは、ザコの顔ぶれ（と宇宙帰り・更生など札の形が変わること）と札の幅が同じあいだは使い回す
 */
let cardFit = { key: '', width: 0, h: 0 };
function fitCard(app, card, animals, worstRow) {
  if (!animals.length) return;
  const key = JSON.stringify([animals.map((a) => [a.id, !!a.space, a.flights || 0]), worstRow ? worstRow.textContent : '']);
  if (cardFit.key === key && cardFit.h) card.style.minHeight = `${cardFit.h}px`; // 作り直したときに、すぐに同じ高さで出す
  // 画面に入ったあと（幅が分かってから）、描く前に測る
  queueMicrotask(() => {
    if (!card.isConnected) return;
    const width = card.offsetWidth;
    if (!width || (cardFit.key === key && cardFit.width === width)) return;
    const probe = el('div', { 'aria-hidden': 'true', style: { position: 'fixed', left: '-10000px', top: '0', width: `${width}px`, visibility: 'hidden' } });
    const cards = animals.map((a) => el('div', { class: 'barn-card' }, ...barnCard(app, a, null, true), worstRow ? worstRow.cloneNode(true) : null));
    probe.append(...cards);
    document.body.append(probe);
    const h = Math.max(...cards.map((c) => c.offsetHeight));
    probe.remove();
    cardFit = { key, width, h };
    card.style.minHeight = `${h}px`;
  });
}

/**
 * 飼育小屋の画面を作り直す目印（ui/facility.js の PANEL_KEYS）。小屋に関わることだけ：ザコの顔ぶれ・宇宙帰り・更生・いる部屋、
 * 部屋（名前と背景）、部屋の数を決める建築の熟練Lv、動物行動学の専攻、機体設計が終わったか。
 * 懐き度の数は作り直さずに書き換える（barnPanel の live.refresh）
 */
export function barnKey(app) {
  const s = app.state;
  const ctx = app.ctx;
  const b = ctx.balance.barn;
  return [
    s.legacy.barn.map((a) => [a.id, !!a.space, a.flights || 0, (a.affinity || 0) >= b.affinityMax, a.room || 0]),
    s.legacy.barnRooms, (s.knowledge.genres[b.roomGenre] || { level: 0 }).level,
    fieldActive(s, ctx, 'ethology'), rocketSteps(s, ctx).some((st) => st.id === 'airframe' && st.done),
  ];
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
  const hint = !animals.length ? ''
    : cur.animals.length ? 'ザコを触ると、懐き度と、誤解と本当のことが見られる（1日に1回、なでると懐き度が上がる）'
      : `${cur.name}にはまだ誰もいない。下の一覧からザコを選んで「この部屋へ」で移せる`;
  const card = el('div', { class: 'barn-card', 'aria-live': 'polite' }, el('div', { class: 'muted' }, hint));
  // 部屋の中の絵（作り直しても同じ絵とザコの歩く位置を使い続ける。roomScene）
  const barn = roomScene(app, world, cur);
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
    // 作り直したとき（touch が無い）は、今日なでた結果をそのまま出す
    if (!touch && lastTouch && lastTouch.id === id && lastTouch.day === app.today()) touch = lastTouch.touch;
    const a = barnAnimals(app.state, app.ctx, world).find((x) => x.id === id);
    if (a) card.replaceChildren(...barnCard(app, a, touch), ...[roomRow(a)].filter(Boolean));
    for (const b of list.querySelectorAll('button[data-id]')) b.classList.toggle('on', b.dataset.id === id);
  };
  const select = (id) => {
    barnPick = { view, id };
    const ev = [];
    const touch = touchZako(app.state, app.ctx, id, app.today(), ev);
    lastTouch = { id, day: app.today(), touch };
    if (touch.gained > 0) app.save();
    if (ev.length) app.handleEvents(ev);
    show(id, touch);
    const w = barn.walkers.get(id);
    if (w) w.reformed = isReformed(app.state, app.ctx, id);
  };
  barn.onPick = select; // 絵の中のザコを押したとき（絵は使い続けるので、押したときの動きはここで差し替える）
  // 一覧の懐き度の数（作り直さずに書き換える。下の live.refresh）
  const affShown = new Map();
  const zakoButton = (a) => {
    const v = Math.floor(a.affinity || 0);
    const small = el('small', {}, `懐き度 ${v}`);
    affShown.set(a.id, { small, v });
    return el('button', { 'data-id': a.id, onclick: () => select(a.id) },
      spriteCanvas((app.monsterSprites[a.id] || {}).idle, 2, app.palette, { halo: isReformed(s, ctx, a.id) }),
      el('span', {}, a.monster.name, small),
      a.space ? el('span', { class: 'space-badge' }, '宇宙') : null);
  };
  // 一覧：部屋ごと（部屋が1つなら見出しなし）。見ている部屋を先に
  const order = [cur, ...rooms.filter((r) => r !== cur)].filter((r) => r.animals.length);
  const list = el('div', { class: 'barn-groups' }, order.map((r) => el('div', { class: 'barn-group' + (r === cur ? ' here' : '') },
    many ? el('div', { class: 'barn-group-name' }, r === cur ? `この部屋（${r.name}）` : r.name, el('small', {}, `${r.animals.length}体`)) : null,
    el('div', { class: 'barn-list' }, r.animals.map(zakoButton)))));
  // 作り直したときは、前に触ったザコの札を出したままにする（触ったことにはしない）
  if (barnPick && barnPick.view === view && animals.some((a) => a.id === barnPick.id)) show(barnPick.id, null);
  else barn.selected = null;
  // 懐き度が上がったら（なでた・誕生日・勉強の正解）、一覧の数と、選んでいるザコの札だけを書き換える（画面は作り直さない）
  live.refresh.push(() => {
    for (const x of barnAnimals(app.state, app.ctx, world)) {
      const r = affShown.get(x.id);
      const v = Math.floor(x.affinity || 0);
      if (!r || r.v === v) continue;
      r.v = v;
      r.small.textContent = `懐き度 ${v}`;
      if (barn.selected === x.id) show(x.id, null);
    }
  });
  // 札の高さをそろえる。部屋が2つ以上なら、札の下の「この部屋へ」の行（部屋の名前がいちばん長いとき）も入れて測る
  const longest = rooms.reduce((x, y) => (y.name.length > x.name.length ? y : x)).name;
  fitCard(app, card, animals, many ? el('div', { class: 'barn-room-row' }, el('span', {}, `いる部屋：${longest}`),
    el('button', { class: 'primary' }, `この部屋（${longest}）へ`)) : null);
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
    el('div', { class: 'barn-box' }, barn.canvas),
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

/**
 * 部屋の中の絵（世界と部屋ごとに1つ）。施設の画面は、階層が進む・Lvが上がる・契約料を払うなどで数秒ごとに作り直されるが、
 * 絵（canvas）とザコの歩く位置は使い続ける（前は作り直すたびにザコが別の場所に置き直され、短い動画を切り替えているように見えた。
 * 40HzP の指摘で直した）。部屋のザコが変わったら、いなくなったザコを外し、来たザコだけを新しい場所に置く
 */
const scenes = new Map();
function roomScene(app, world, cur) {
  const key = `${world}:${cur.index}`;
  let sc = scenes.get(key);
  if (!sc) {
    const canvas = el('canvas', { class: 'pixel barn-scene', width: BARN_W, height: BARN_H });
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    sc = { canvas, g, walkers: new Map(), selected: null, last: 0, running: false, onPick: null };
    canvas.addEventListener('click', (ev) => {
      const r = canvas.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * BARN_W, py = ((ev.clientY - r.top) / r.height) * BARN_H;
      // 手前（足元が下）のザコから。指でも押しやすいように少し広めに
      const hit = [...sc.walkers.values()].sort((p, q) => q.y - p.y).find((w) => px >= w.x - 2 && px <= w.x + 18 && py >= w.y - 2 && py <= w.y + 18);
      if (hit && sc.onPick) sc.onPick(hit.a.id);
    });
    scenes.set(key, sc);
  }
  sc.canvas.setAttribute('aria-label', `${BARN_NAMES[world]}の${cur.name}の中`);
  sc.bg = cur.bg;
  sc.sprite = roomSprite(app, cur.bg);
  // ザコが歩ける床（ザコの絵の左上。足元が床に乗るように。床の上の端は背景ごと：town.json の floorY）
  const area = sc.area = { x0: 0, x1: BARN_W - 16, y0: cur.bg ? cur.bg.floorY : 15, y1: BARN_H - 17 };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const next = new Map();
  for (const a of cur.animals.slice(-BARN_SHOW)) {
    let w = sc.walkers.get(a.id);
    if (!w) {
      const x = rnd(area.x0, area.x1), y = rnd(area.y0, area.y1);
      w = { x, y, tx: x, ty: y, wait: rnd(0, 2), flip: Math.random() < 0.5, speed: rnd(5, 9) };
    }
    // 背景を替えて床の高さが変わっても、床の上に収める
    w.y = clamp(w.y, area.y0, area.y1); w.ty = clamp(w.ty, area.y0, area.y1);
    Object.assign(w, { a, sp: (app.monsterSprites[a.id] || {}).idle, reformed: isReformed(app.state, app.ctx, a.id) });
    next.set(a.id, w);
  }
  sc.walkers = next;
  // 作ってすぐに1枚描いておく（画面に入れた瞬間に空の絵が見えないように）
  drawBarn(app, sc, performance.now() / 1000);
  // 歩くザコは画面の更新（0.2秒ごと）より細かく動かす。施設を出て絵が外れたら止まり、また入ったら動き出す
  if (!sc.running) {
    sc.running = true;
    const loop = () => {
      if (!sc.canvas.isConnected) { sc.running = false; sc.last = 0; return; }
      if (!root.hidden) drawBarn(app, sc, performance.now() / 1000);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  return sc;
}

/** 部屋の中のザコを歩かせて描く（毎フレーム）。生態展示の背景は、階層の背景（90×160）の crop 行目から下を見せる */
function drawBarn(app, barn, now) {
  const dt = barn.last ? Math.min(0.1, now - barn.last) : 0;
  barn.last = now;
  const { g, area } = barn;
  g.clearRect(0, 0, BARN_W, BARN_H);
  if (barn.sprite) drawSprite(g, barn.sprite, 0, 0, -((barn.bg && barn.bg.crop) || 0));
  else drawPlaceholder(g, 0, 0, BARN_W, BARN_H, app.palette);
  for (const w of barn.walkers.values()) {
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
  for (const w of [...barn.walkers.values()].sort((p, q) => p.y - q.y)) {
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
