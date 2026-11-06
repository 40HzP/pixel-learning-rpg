// 装備に合わせた主人公の見た目（40HzP の依頼「装備に合わせて見た目も変わるようにして」）。
// 主人公の絵（hero_* / heroine_*）の色を、付けている装備の items.json の look に合わせて塗り替える。
// 計算だけ（絵は読むだけで書き換えない。エディタで主人公の絵を手直ししても、そのまま塗り替えられる）。
//
// 塗り替えるところ（主人公の絵の色のキーで決まっている）
// - 剣（若い姿の待機と攻撃だけ。年を取った姿は杖のまま）：11列目から右の 4（刃の先・光）・3（刃）・f（つば）・g（つばの光）。
//   武器を付けていないと剣を消して素手にする（消したところの手の輪郭は描き足し、剣の輪郭だけ残った点は消す）
// - 服（すべての姿）：頭より下（9行目から）の n・m・l（服の明・中・暗。l はズボンにも使う）と u・v（えりとマフラー）。
//   防具を付けていないと、いつもの青い服のまま
// - 装飾品：shoes（いちばん下の行の 9＝靴）・brooch（えりの光 v）・glasses（目の上に光るレンズ。colors でレンズの色）・cape（背中のマフラーを伸ばしたマント）

const WEAPON_KEYS = { 4: 'tip', 3: 'blade', f: 'guard', g: 'guardLight' };
const ARMOR_KEYS = { n: 'light', m: 'cloth', l: 'shade', u: 'collar', v: 'collarLight' };
export const SWORD_FROM_X = 11; // 剣は11列目から右（頭・体・ベルトの金具は10列目まで）
const BODY_FROM_Y = 9;          // 服は9行目から下（頭は8行目まで）
const SKIN = new Set(['5', '6', '7', 's', 't']);
const NEAR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const NEAR8 = [...NEAR4, [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** 付けている装備（武器・防具・装飾品）の id と look。付けていない枠は null */
export function outfitOf(state, items) {
  const worn = (slot) => {
    const id = state.equipment && state.equipment[slot];
    const it = id ? items.find((i) => i.id === id) : null;
    return it ? { id: it.id, look: it.look || null } : null;
  };
  return { weapon: worn('weapon'), armor: worn('armor'), accessory: worn('accessory') };
}

/** 見た目の組み合わせの名前（同じ組み合わせの絵は1回だけ作る） */
export const outfitKey = (o) => [o.weapon, o.armor, o.accessory].map((x) => (x ? x.id : '-')).join('|');

/**
 * 1枚の絵（文字の行の並び）を装備に合わせて塗り替えた行の並びを返す。
 * armed：剣を持っている絵か（若い姿の待機と攻撃）。false の絵（年を取った姿）は剣にさわらない
 */
export function dressFrame(rows, outfit, armed) {
  const g = rows.map((r) => [...r]);
  const h = g.length, w = h ? g[0].length : 0;
  const at = (x, y) => (y >= 0 && y < h && x >= 0 && x < (g[y] || []).length ? g[y][x] : '.');
  const colored = (x, y) => { const c = at(x, y); return c !== '.' && c !== '0'; };
  const locked = g.map((r) => r.map(() => false)); // 装飾品で塗ったところ（服の色で塗り直さない）
  const set = (x, y, c) => { if (y >= 0 && y < h && x >= 0 && x < g[y].length) { g[y][x] = c; locked[y][x] = true; } };

  // 剣
  if (armed) {
    const look = outfit.weapon && outfit.weapon.look;
    if (outfit.weapon) {
      if (look) for (let y = 0; y < h; y++) for (let x = SWORD_FROM_X; x < g[y].length; x++) {
        const role = WEAPON_KEYS[g[y][x]];
        if (role && look[role]) g[y][x] = look[role];
      }
    } else {
      const removed = [];
      for (let y = 0; y < h; y++) for (let x = SWORD_FROM_X; x < g[y].length; x++) {
        if (WEAPON_KEYS[g[y][x]]) { g[y][x] = '.'; removed.push([x, y]); }
      }
      for (const [x, y] of removed) if (NEAR4.some(([dx, dy]) => colored(x + dx, y + dy))) g[y][x] = '0';
      for (let y = 0; y < h; y++) for (let x = SWORD_FROM_X - 1; x < g[y].length; x++) {
        if (g[y][x] === '0' && !NEAR8.some(([dx, dy]) => colored(x + dx, y + dy))) g[y][x] = '.';
      }
    }
  }

  // 装飾品（もとの絵の色で場所を決める）
  const acc = outfit.accessory && outfit.accessory.look;
  const colors = (acc && acc.colors) || [];
  const color = (i) => colors[Math.min(i, colors.length - 1)];
  if (acc && acc.type === 'shoes' && colors.length) {
    const y = h - 1;
    for (let x = 0; x < Math.min(w, SWORD_FROM_X + 1); x++) {
      if (g[y][x] === '9') set(x, y, color(at(x - 1, y) === '9' || (locked[y][x - 1] && at(x - 1, y) !== '0') ? 1 : 0));
    }
  }
  if (acc && acc.type === 'brooch' && colors.length) {
    let k = 0;
    for (let y = BODY_FROM_Y; y < h; y++) for (let x = 0; x < g[y].length; x++) if (g[y][x] === 'v') set(x, y, color(k++));
  }
  if (acc && acc.type === 'glasses') {
    // 目：上から最初の、左右が肌の色の黒い点。その点を白く光らせ、左に水色（眼鏡のレンズ）。
    // colors があればレンズと光の色（金のバイザー＝山吹と黄）
    eye: for (let y = 0; y < BODY_FROM_Y; y++) for (let x = 1; x < g[y].length - 1; x++) {
      if (g[y][x] === '0' && SKIN.has(g[y][x - 1]) && SKIN.has(g[y][x + 1])) { set(x, y, colors[1] || '4'); set(x - 1, y, colors[0] || 'o'); break eye; }
    }
  }
  if (acc && acc.type === 'cape' && colors.length) {
    // 背中のマフラー（左の端の u）をマントの色にし、いちばん下から2つ下まで伸ばす
    const scarf = [];
    for (let y = BODY_FROM_Y; y < h; y++) for (let x = 0; x <= 2; x++) if (g[y][x] === 'u') scarf.push([x, y]);
    for (const [x, y] of scarf) set(x, y, color(0));
    if (scarf.length) {
      const [sx, sy] = scarf.reduce((a, b) => (b[1] > a[1] ? b : a));
      for (let d = 1; d <= 2 && sy + d < h - 1; d++) {
        if (at(sx, sy + d) === '.' || at(sx, sy + d) === '0') set(sx, sy + d, color(1));
        if (at(sx - 1, sy + d) === '.') set(sx - 1, sy + d, '0');
      }
      const end = Math.min(sy + 3, h - 1);
      if (at(sx, end) === '.') set(sx, end, '0');
    }
  }

  // 服
  const armor = outfit.armor && outfit.armor.look;
  if (armor) for (let y = BODY_FROM_Y; y < h; y++) for (let x = 0; x < g[y].length; x++) {
    const role = ARMOR_KEYS[g[y][x]];
    if (role && !locked[y][x] && armor[role]) g[y][x] = armor[role];
  }
  return g.map((r) => r.join(''));
}

/** 絵（全部の枚）を塗り替える */
export const dressFrames = (frames, outfit, armed) => frames.map((rows) => dressFrame(rows, outfit, armed));
