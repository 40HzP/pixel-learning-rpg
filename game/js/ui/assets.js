// 起動のときに読む絵（スプライト）。データとコードに名前を書いた絵だけを読む（ブラウザはフォルダの中身を一覧できないため）。
// 下の切り替えバーの板とアイコンも、ここで貼る。2026-11-09 に main.js から分けた
import { loadPalette, loadSprite, spriteCanvas, buildSprite } from '../sprites.js';
import { outfitOf, outfitKey, dressFrames } from '../outfit.js';
import { MENU_LOOK } from './study.js';

/**
 * 絵をまとめて読む。data は読み込んだデータ（monsters・recruits・items・stages・town・genreGroups）。
 * 返すもの：palette・魔物と仲間の絵・主人公の絵（heroSets と、装備に合わせて塗り替える heroLooks）・場面の絵・世界の背景・街の絵・アイコン
 */
export async function loadAssets(pixelDir, { monsters, recruits, items, stages, town, genreGroups }) {
  const palette = await loadPalette(pixelDir + 'palette.json');
  const load = (name) => loadSprite(name, palette, pixelDir + 'sprites/');
  const monsterSprites = {};
  const recruitSprites = {};
  await Promise.all([
    ...monsters.map(async (m) => {
      monsterSprites[m.id] = { idle: await load(m.sprites.idle), attack: await load(m.sprites.attack) };
      // 学校の先生：正面を向いて破れたテスト用紙を持つ絵（用紙を破りすてたときのミニモーション。怒り顔と困惑顔）
      if (m.sprites.scold) monsterSprites[m.id].scold = await load(m.sprites.scold);
      if (m.sprites.puzzled) monsterSprites[m.id].puzzled = await load(m.sprites.puzzled);
      // 大喜利の答えを提出したとき：答案を持つ絵（顔ごと）
      if (m.sprites.oogiri) {
        const o = monsterSprites[m.id].oogiri = {};
        await Promise.all(Object.entries(m.sprites.oogiri).map(async ([mood, name]) => { o[mood] = await load(name); }));
      }
      // 月面のボス：正解で山と影を描き足した絵（marked）・分かれた地球と月（parts）・倒したあとに残るもの（remains）
      if (m.sprites.marked) monsterSprites[m.id].marked = await Promise.all(m.sprites.marked.map(load));
      if (m.sprites.parts) {
        const o = monsterSprites[m.id].parts = {};
        await Promise.all(Object.entries(m.sprites.parts).map(async ([part, name]) => { o[part] = await load(name); }));
      }
      if (m.remains) monsterSprites[m.id].remains = await load(m.remains.sprite);
    }),
    ...recruits.filter((r) => r.sprites).map(async (r) => {
      recruitSprites[r.id] = { idle: await load(r.sprites.idle), attack: await load(r.sprites.attack) };
    }),
  ]);
  // 主人公の絵。男の子は hero_*、女の子は heroine_*（同じ形・同じ大きさ。性別は初回起動時と転生時に選ぶ）。
  // old_idle・old_attack：年を取った姿（体の不調を感じ始めてからの冒険画面と、体の不調と寿命のミニムービーに出る）。
  // bow：先生にあやまる（用紙を破りすてたとき）。blush：赤面する（テストに大喜利を書いたとき）
  const heroSet = async (prefix) => {
    const [idle, attack, old, oldAttack, bow, blush] = await Promise.all(
      ['idle', 'attack', 'old_idle', 'old_attack', 'bow', 'blush'].map((k) => load(`${prefix}_${k}`)));
    return { idle, attack, old, oldAttack, bow, blush };
  };
  const heroSets = { male: await heroSet('hero'), female: await heroSet('heroine') };
  // 装備に合わせて塗り替えた主人公の絵（outfit.js）。性別と装備の組み合わせごとに1回だけ作る。
  // 剣を持つのは若い姿の待機と攻撃だけ（年を取った姿は杖のまま、服と装飾品だけ変わる）。あやまる・赤面する絵は変えない
  const dressed = new Map();
  const dressSprite = (sp, outfit, armed) => (sp && sp.rows
    ? buildSprite({ name: sp.name, w: sp.w, h: sp.h, fps: sp.fps, frames: dressFrames(sp.rows, outfit, armed) }, palette) || sp
    : sp);
  function heroLooks(state) {
    const g = state && state.hero.gender === 'female' ? 'female' : 'male';
    const outfit = outfitOf(state || { equipment: {} }, items);
    const key = `${g}|${outfitKey(outfit)}`;
    if (!dressed.has(key)) {
      const set = heroSets[g];
      dressed.set(key, { ...set, idle: dressSprite(set.idle, outfit, true), attack: dressSprite(set.attack, outfit, true), old: dressSprite(set.old, outfit, false), oldAttack: dressSprite(set.oldAttack, outfit, false) });
    }
    return dressed.get(key);
  }
  // 用紙を破りすてたときのミニモーションの教室（背景と、先生の前に重ねる教卓）。ロケットのミニムービーの打ち上げ場と飛ぶロケット。
  // 飼育小屋と月面の飼育ドームの中（ザコが歩き回る）
  const [classroom, lectern, launchpad, rocket, barn, moonBarn] = await Promise.all([load('scene_classroom'), load('scene_lectern'), load('scene_launchpad'), load('rocket_flight'), load('scene_barn'), load('scene_moon_barn')]);
  // 10階層ごとの世界の背景（stages.json に書いた名前だけ読む）
  const stageList = await Promise.all(stages.map(async (st) => ({ ...st, bg: await load(st.background) })));
  // 施設画面の街：背景と施設の外観（town.json に書いた名前だけ読む）
  const townSprites = {};
  const [townBg] = await Promise.all([
    load(town.background),
    ...town.facilities.map(async (f) => { townSprites[f.id] = await load(f.sprite); }),
    town.board ? load(town.board.sprite).then((sp) => { townSprites.board = sp; }) : null, // 今日の1問の掲示板
  ]);
  // 月面の街（town.json の moon。月面にいる間は地球の街の代わりに出る）
  const moonSprites = {};
  const [moonBg] = await Promise.all([
    load(town.moon.background),
    ...town.moon.facilities.map(async (f) => { moonSprites[f.id] = await load(f.sprite); }),
    town.moon.board ? load(town.moon.board.sprite).then((sp) => { moonSprites.board = sp; }) : null, // 月面の街の掲示板（地球と同じ）
  ]);
  // テストのジャンルを選ぶボタンのアイコン（genre-groups.json に書いた名前だけ読む。無ければ仮の図形）
  const genreSprites = {};
  await Promise.all(genreGroups.flatMap((g) => g.genres).map(async (x) => { genreSprites[x.name] = await load(x.icon); }));
  // 店の品物のアイコン（items.json の icon に書いた名前だけ読む。無ければ仮の図形）
  const itemSprites = {};
  await Promise.all(items.map(async (it) => { itemSprites[it.id] = await load(it.icon); }));
  // 勉強のメニューのボタンのアイコン（study.js の MENU_LOOK に書いた名前だけ読む）
  const menuSprites = {};
  await Promise.all(Object.entries(MENU_LOOK).map(async ([id, m]) => { menuSprites[id] = await load(m.icon); }));
  // 下の切り替えバーのコルクの板（ui_tabs_cork）。1枚が1つのボタンの板で、ボタンの順に1枚目・2枚目…と使う
  // （板ごとに粒の並びがちがう）。2倍に拡大してボタンの背景にする（CSS の --board）。無ければ CSS のコルク色の地
  const corkSprite = await load('ui_tabs_cork');
  if (corkSprite) {
    const boards = corkSprite.frames.map((img) => {
      const big = document.createElement('canvas');
      big.width = corkSprite.w * 2; big.height = corkSprite.h * 2;
      const g = big.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 0, 0, big.width, big.height);
      return `url(${big.toDataURL()})`;
    });
    document.getElementById('tabs').style.setProperty('--board-size', `${corkSprite.w * 2}px ${corkSprite.h * 2}px`);
    [...document.querySelectorAll('#tabs button')].forEach((b, i) => b.style.setProperty('--board', boards[i % boards.length]));
  }
  // 下の切り替えバーのアイコン（index.html のボタンの data-icon に書いた名前だけ読む。無ければ字だけ）
  await Promise.all([...document.querySelectorAll('#tabs button[data-icon]')].map(async (b) => {
    const sp = await load(b.dataset.icon);
    if (sp) b.prepend(spriteCanvas(sp, 2, palette));
  }));

  return {
    palette, monsterSprites, recruitSprites, heroSets, heroLooks,
    sceneSprites: { classroom, lectern, launchpad, rocket, barn, moonBarn },
    stageList, townBg, townSprites, moonBg, moonSprites, genreSprites, itemSprites, menuSprites,
  };
}
