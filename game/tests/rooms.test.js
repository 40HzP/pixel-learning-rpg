// 飼育小屋の部屋分けと部屋の背景（設計ページ「部屋分け（2026-11-11）」「部屋の背景」）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import {
  tick, reincarnate, genreState, worldOf, tameZako, barnAnimals, flyPrototype, HOURS_PER_YEAR,
  barnRoomsOf, barnRoomInfo, syncBarnRooms, moveToRoom, renameBarnRoom, ROOM_NAME_MAX,
  barnBackgrounds, barnBackgroundById, roomBackground, setRoomBackground, barnRoomList,
} from '../js/sim.js';
import { serialize, deserialize } from '../js/save.js';
import { balance, monsters, stages, makeCtx, newGame, constRng } from './helpers.js';

const b = balance.barn;
const earthZako = monsters.filter((m) => m.kind === 'monster' && worldOf(m) === 'earth');
const moonZako = monsters.filter((m) => m.kind === 'monster' && worldOf(m) === 'moon');
const setArch = (s, level) => { genreState(s, b.roomGenre).level = level; };

test('データ：部屋の数は建築の熟練で、地球は4部屋・月面は2部屋まで（40HzP の判断）', () => {
  assert.equal(b.roomGenre, '建築');
  assert.deepEqual(b.roomsMax, { earth: 4, moon: 2 });
});

test('はじめは広間1部屋。建築の熟練Lv1つにつき1部屋増え、地球はLv3で4部屋・月面はLv1で2部屋でそろう', () => {
  const s = newGame(7);
  const ctx = makeCtx();
  for (const w of ['earth', 'moon']) assert.deepEqual(barnRoomsOf(s, w), [{ name: '広間', bg: null }]);
  const ev = [];
  syncBarnRooms(s, ctx, ev);
  assert.deepEqual(ev, []);
  setArch(s, 1);
  syncBarnRooms(s, ctx, ev);
  assert.equal(barnRoomsOf(s, 'earth').length, 2);
  assert.equal(barnRoomsOf(s, 'moon').length, 2);
  assert.deepEqual(ev.map((e) => [e.type, e.world, e.rooms]), [['barnRoom', 'earth', 2], ['barnRoom', 'moon', 2]]);
  setArch(s, 3);
  ev.length = 0;
  syncBarnRooms(s, ctx, ev);
  assert.deepEqual(barnRoomsOf(s, 'earth').map((r) => r.name), ['広間', '部屋2', '部屋3', '部屋4']);
  assert.equal(barnRoomsOf(s, 'moon').length, 2);
  assert.deepEqual(ev.map((e) => [e.world, e.rooms]), [['earth', 4]]); // 月面はもう最大なので知らせない
  setArch(s, 10);
  ev.length = 0;
  syncBarnRooms(s, ctx, ev);
  assert.equal(barnRoomsOf(s, 'earth').length, 4);
  assert.deepEqual(ev, []);
  assert.deepEqual(barnRoomInfo(s, ctx, 'earth'), { built: 4, max: 4, genre: '建築', level: 10, nextLevel: null });
});

test('次の部屋が建つ熟練Lvが分かる', () => {
  const s = newGame(7);
  const ctx = makeCtx();
  assert.equal(barnRoomInfo(s, ctx, 'earth').nextLevel, 1);
  setArch(s, 1);
  syncBarnRooms(s, ctx, []);
  assert.equal(barnRoomInfo(s, ctx, 'earth').nextLevel, 2);
  assert.equal(barnRoomInfo(s, ctx, 'moon').nextLevel, null);
});

test('建築の熟練が下がっても部屋は残り、生まれ変わっても残る', () => {
  const s = newGame(7);
  const ctx = makeCtx(constRng(0));
  setArch(s, 2);
  syncBarnRooms(s, ctx, []);
  setArch(s, 0);
  syncBarnRooms(s, ctx, []);
  assert.equal(barnRoomsOf(s, 'earth').length, 3);
  renameBarnRoom(s, 'earth', 1, '森の部屋');
  tameZako(s, ctx, earthZako[0].id, [], true);
  moveToRoom(s, ctx, earthZako[0].id, 1);
  reincarnate(s, ctx);
  assert.deepEqual(barnRoomsOf(s, 'earth').map((r) => r.name), ['広間', '森の部屋', '部屋3']);
  assert.equal(barnAnimals(s, ctx, 'earth')[0].room, 1);
});

test('時間を進めると（tick）建築の熟練に合わせて部屋が建ち、知らせが出る', () => {
  const s = newGame(7);
  const ctx = makeCtx(constRng(0.99));
  setArch(s, 2);
  const ev = tick(s, 0.1, ctx);
  assert.deepEqual(ev.filter((e) => e.type === 'barnRoom').map((e) => [e.world, e.rooms, e.barn]), [['earth', 3, '飼育小屋'], ['moon', 2, '月面の飼育ドーム']]);
  assert.equal(tick(s, 0.1, ctx).filter((e) => e.type === 'barnRoom').length, 0);
});

test('新しくなついたザコは広間に入り、選んだ部屋へ移せる（同じ世界の、建っている部屋だけ）', () => {
  const s = newGame(7);
  const ctx = makeCtx();
  setArch(s, 3);
  syncBarnRooms(s, ctx, []);
  const [z1, z2, z3] = earthZako;
  for (const z of [z1, z2, z3, moonZako[0]]) tameZako(s, ctx, z.id, [], true);
  assert.deepEqual(barnAnimals(s, ctx, 'earth').map((a) => a.room), [0, 0, 0]);
  const r = moveToRoom(s, ctx, z1.id, 2);
  assert.deepEqual(r, { ok: true, name: z1.name, room: '部屋3' });
  // 移したザコは並びの後ろへ（移した部屋で歩くように）
  assert.deepEqual(barnAnimals(s, ctx, 'earth').map((a) => [a.id, a.room]), [[z2.id, 0], [z3.id, 0], [z1.id, 2]]);
  assert.equal(moveToRoom(s, ctx, z1.id, 2).ok, false); // もうその部屋にいる
  assert.equal(moveToRoom(s, ctx, z1.id, 4).ok, false); // 建っていない
  assert.equal(moveToRoom(s, ctx, moonZako[0].id, 2).ok, false); // 月面のドームは2部屋まで
  assert.equal(moveToRoom(s, ctx, moonZako[0].id, 1).ok, true);
  assert.equal(moveToRoom(s, ctx, 'nobody', 0).ok, false);
  const list = barnRoomList(s, ctx, 'earth');
  assert.deepEqual(list.map((x) => x.animals.map((a) => a.id)), [[z2.id, z3.id], [], [z1.id], []]);
});

test('試作機から帰ってこなかったザコが、また懐いたら広間から', () => {
  const s = newGame(7);
  const ctx = makeCtx(constRng(0.99)); // 試作機は失敗し、懐き度0なので帰ってこない
  setArch(s, 1);
  syncBarnRooms(s, ctx, []);
  const z = earthZako.find((m) => !m.space);
  tameZako(s, ctx, z.id, [], true);
  moveToRoom(s, ctx, z.id, 1);
  s.legacy.rocket.steps.airframe = balance.rocket.stepYears * HOURS_PER_YEAR;
  s.gold = balance.rocket.prototype.cost;
  assert.equal(flyPrototype(s, ctx, z.id).left, true);
  tameZako(s, ctx, z.id, [], true);
  assert.equal(barnAnimals(s, ctx, 'earth')[0].room, 0);
});

test('部屋の名前は8文字まで。空にすると既定の名前に戻る', () => {
  const s = newGame(7);
  const ctx = makeCtx();
  setArch(s, 1);
  syncBarnRooms(s, ctx, []);
  assert.equal(ROOM_NAME_MAX, 8);
  assert.equal(renameBarnRoom(s, 'earth', 1, '  ふるさとの森のおうちだよ  '), 'ふるさとの森のお');
  assert.equal(renameBarnRoom(s, 'earth', 1, '\u0007'), '部屋2');
  assert.equal(renameBarnRoom(s, 'earth', 0, ''), '広間');
  assert.equal(renameBarnRoom(s, 'earth', 3, 'まだない'), null);
});

test('部屋の背景：いつもの2つ・生態展示10・新しく描いた5つ。どの世界でも全部選べる', () => {
  const ctx = makeCtx();
  const list = barnBackgrounds(ctx);
  const earthStages = stages.filter((st) => !st.world);
  assert.equal(earthStages.length, 10);
  assert.equal(list.length, 2 + 10 + 5);
  assert.deepEqual(list.filter((x) => x.area).map((x) => x.area), earthStages.map((st) => st.name));
  assert.deepEqual(list.filter((x) => !x.area).map((x) => x.name), ['いつもの小屋', 'いつものドーム', '分類展示', '行動展示', '宇宙の待機室', '更生の教室', '言葉の書斎']);
  for (const x of list) {
    assert.ok(x.note && !x.note.includes('{area}'), x.id);
    assert.ok(x.floorY >= 0 && x.floorY + 16 <= 64, x.id);
    // 絵が pixel/sprites にある（ゲームは名前を書いた絵だけを読む）
    assert.ok(existsSync(new URL(`../../pixel/sprites/${x.sprite}.json`, import.meta.url)), x.sprite);
  }
  assert.equal(new Set(list.map((x) => x.id)).size, list.length);
  // 選んでいなければ、その世界のいつもの背景
  assert.equal(roomBackground(ctx, { name: '広間', bg: null }, 'earth').name, 'いつもの小屋');
  assert.equal(roomBackground(ctx, { name: '広間', bg: null }, 'moon').name, 'いつものドーム');
  assert.equal(roomBackground(ctx, { name: '広間', bg: 'gone' }, 'moon').name, 'いつものドーム');
  const s = newGame(7);
  assert.deepEqual(setRoomBackground(s, ctx, 'moon', 0, 'barn'), { ok: true, name: 'いつもの小屋' });
  assert.equal(setRoomBackground(s, ctx, 'earth', 0, 'habitat:51').name, '生態展示（火山）');
  assert.equal(setRoomBackground(s, ctx, 'earth', 0, 'nothing').ok, false);
  assert.equal(setRoomBackground(s, ctx, 'earth', 1, 'barn').ok, false);
  assert.equal(barnRoomList(s, ctx, 'moon')[0].bg.id, 'barn');
  assert.equal(barnBackgroundById(ctx, 'habitat:1').sprite, stages[0].background);
});

test('生態展示の部屋に、そのエリアに出るザコだけを集めると「ふるさと」の部屋になる', () => {
  const s = newGame(7);
  const ctx = makeCtx();
  const area = 'はじまりの草原';
  const from = earthZako.filter((m) => (m.areas || []).includes(area));
  const other = earthZako.find((m) => !(m.areas || []).includes(area));
  setRoomBackground(s, ctx, 'earth', 0, 'habitat:1');
  assert.equal(barnRoomList(s, ctx, 'earth')[0].home, null); // 誰もいない
  tameZako(s, ctx, from[0].id, [], true);
  tameZako(s, ctx, from[1].id, [], true);
  assert.equal(barnRoomList(s, ctx, 'earth')[0].home, area);
  tameZako(s, ctx, other.id, [], true);
  assert.equal(barnRoomList(s, ctx, 'earth')[0].home, null);
});

test('部屋はセーブに残る。前のセーブ（部屋の欄が無い）は広間だけで、ザコはみんな広間', () => {
  const s = newGame(7);
  const ctx = makeCtx();
  setArch(s, 1);
  syncBarnRooms(s, ctx, []);
  setRoomBackground(s, ctx, 'earth', 1, 'study');
  tameZako(s, ctx, earthZako[0].id, [], true);
  moveToRoom(s, ctx, earthZako[0].id, 1);
  const back = deserialize(serialize(s), balance);
  assert.deepEqual(back.legacy.barnRooms, s.legacy.barnRooms);
  assert.deepEqual(back.legacy.barn, s.legacy.barn);
  const old = JSON.parse(serialize(s));
  delete old.state.legacy.barnRooms;
  for (const a of old.state.legacy.barn) delete a.room;
  const loaded = deserialize(JSON.stringify(old), balance);
  assert.deepEqual(loaded.legacy.barnRooms, { earth: [{ name: '広間', bg: null }], moon: [{ name: '広間', bg: null }] });
  assert.deepEqual(barnAnimals(loaded, ctx, 'earth').map((a) => a.room), [0]);
});
