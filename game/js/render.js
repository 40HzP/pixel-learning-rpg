// 冒険画面の描画（90×160 のキャンバス）。攻撃エフェクト・ダメージ数字・HPバーはここで描く。
import { drawSprite, drawPlaceholder, frameAt, cssColor } from './sprites.js';
import { heroStats, isInvulnerable, stageFor, partyAllies } from './sim.js';

export const SCENE_W = 90;
export const SCENE_H = 160;
const FEET_Y = 136;                       // 主人公の足元（style-guide：キャラクターは y=105〜150 に立つ）
const X = { hero: 21 };
// 仲間の並び（主人公の後ろ。仲間になった順に置く）
const ALLY_SLOTS = [
  { x: 3, feet: 136 },
  { x: 9, feet: 125 },
  { x: 9, feet: 149 },
  { x: -2, feet: 128 },
  { x: -2, feet: 147 },
];

// 敵の群れの並び（群れの中の番号 slot → 絵の左端 x と足元 y）。先頭（slot 0）がいちばん手前
const FORMATION = [
  { x: 47, feet: 138 },
  { x: 61, feet: 127 },
  { x: 62, feet: 151 },
  { x: 74, feet: 139 },
  { x: 74, feet: 117 },
];
const slotPos = (slot) => FORMATION[(slot || 0) % FORMATION.length];
// 大きい敵（小ボス 32×32 など）は群れの並びを使わず、右寄りに1体で立たせる
const BIG_FEET = 141;
// 世界が変わるときの暗転（前半で暗くなり、真っ暗の瞬間に背景を入れ替え、後半で明るくなる）
const STAGE_FADE_SEC = 0.5;

// 3×5 のドット数字（ダメージ表示用）
const DIGITS = {
  0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'], 3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '001', '010', '010'],
  8: ['111', '101', '111', '101', '111'], 9: ['111', '101', '111', '001', '111'],
  '+': ['000', '010', '111', '010', '000'],
};

// 世界の切り替えの暗転。step(今の世界, 時刻) が { shown: 描く世界, dark: 暗さ 0〜1 } を返す。
// 最初の1回（起動・読み込み直後）は暗転しない。暗転の途中で行き先が変わったら、今の暗さから続ける
export function createStageFade(sec = STAGE_FADE_SEC) {
  let shown;
  let fade = null; // { t0, to }
  const darkness = (t) => (t < 0.5 ? t * 2 : Math.max(0, (1 - t) * 2));
  return function step(stage, now) {
    if (shown === undefined) { shown = stage; return { shown, dark: 0 }; }
    if (stage !== (fade ? fade.to : shown)) {
      const d = fade ? darkness((now - fade.t0) / sec) : 0;
      fade = { t0: now - (d * sec) / 2, to: stage };
    }
    if (!fade) return { shown, dark: 0 };
    const t = (now - fade.t0) / sec;
    if (t >= 0.5) shown = fade.to;
    if (t >= 1) { fade = null; return { shown, dark: 0 }; }
    return { shown, dark: darkness(t) };
  };
}

export function createRenderer(canvas, app) {
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  const pal = app.palette;
  const col = (k, fallback) => cssColor(pal, k, fallback);
  const fx = [];
  const anim = { heroAt: -9, spellAt: -9, spawnAt: -9 };
  const allyAt = new Map();        // 仲間id → 攻撃・回復した時刻
  const enemyAttackAt = new Map(); // uid → 時刻
  const enemyHitAt = new Map();    // uid → 時刻
  const dying = [];                // { monsterId, slot, t0 }
  const stageFade = createStageFade();

  function textWidth(s) { return s.length * 4 - 1; }
  function drawNumber(s, x, y, color) {
    let cx = Math.round(x - textWidth(s) / 2);
    y = Math.round(y);
    for (const ch of s) {
      const glyph = DIGITS[ch];
      if (glyph) {
        for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
          if (glyph[r][c] !== '1') continue;
          g.fillStyle = col('0'); g.fillRect(cx + c + 1, y + r + 1, 1, 1);
          g.fillStyle = color; g.fillRect(cx + c, y + r, 1, 1);
        }
      }
      cx += 4;
    }
  }

  const spriteOf = (id, kind) => (app.monsterSprites[id] || {})[kind] || null;
  const kindOf = new Map(app.ctx.monsters.map((m) => [m.id, m.kind]));

  /** 敵の絵の位置と大きさ：左端 x・足元 feet・幅 w・高さ h（中心は cx, cy、頭の上は top） */
  function enemyBox(monsterId, slot) {
    const sp = spriteOf(monsterId, 'idle');
    const w = sp ? sp.w : kindOf.get(monsterId) === 'boss' ? 32 : 16;
    const h = sp ? sp.h : w;
    const p = w > 16 ? { x: SCENE_W - w - 3, feet: BIG_FEET } : slotPos(slot);
    const top = p.feet - h;
    return { x: p.x, feet: p.feet, w, h, top, cx: p.x + w / 2, cy: top + h / 2 };
  }

  function addNumber(f) {
    // 数字が重なりすぎないように、同時に出すのは4つまで
    const nums = fx.filter((x) => x.type === 'num');
    if (nums.length >= 4) fx.splice(fx.indexOf(nums[0]), 1);
    fx.push({ type: 'num', ...f });
  }

  function onEvents(events, now) {
    for (const e of events) {
      if (e.type === 'attack' && e.target === 'enemy') {
        const p = enemyBox(e.monsterId, e.slot);
        if (e.by === 'hero') anim.heroAt = now;
        if (e.by === 'ally') allyAt.set(e.allyId, now);
        enemyHitAt.set(e.uid, now);
        const color = e.dmg === 0 ? col('3') : e.by === 'quiz' ? col('g') : e.crit ? col('e') : e.by === 'spell' ? col('o') : col('4');
        addNumber({ text: String(e.dmg), x: p.cx, y: p.top - 6, t0: now, color });
        if (e.by === 'quiz' || e.by === 'spell') fx.push({ type: 'burst', cx: p.cx, cy: p.cy, t0: now, big: e.by === 'quiz' });
        else fx.push({ type: 'slash', cx: p.cx, cy: p.cy, t0: now, crit: !!e.crit });
      } else if (e.type === 'attack' && e.target === 'hero') {
        enemyAttackAt.set(e.uid, now);
        addNumber({ text: String(e.dmg), x: X.hero + 8, y: FEET_Y - 22, t0: now, color: col('d') });
      } else if (e.type === 'heal' && e.target === 'hero' && e.amount > 0) {
        allyAt.set(e.allyId, now);
        addNumber({ text: '+' + e.amount, x: X.hero + 8, y: FEET_Y - 26, t0: now, color: col('j') });
      } else if (e.type === 'heal' && e.amount > 0) {
        const p = enemyBox(e.monsterId, e.slot);
        addNumber({ text: '+' + e.amount, x: p.cx, y: p.top - 10, t0: now, color: col('j') });
      } else if (e.type === 'spell') {
        anim.spellAt = now;
        anim.heroAt = now;
      } else if (e.type === 'spawn') {
        anim.spawnAt = now;
      } else if (e.type === 'defeat') {
        dying.push({ monsterId: e.monsterId, slot: e.slot, t0: now });
        enemyAttackAt.delete(e.uid);
        enemyHitAt.delete(e.uid);
      }
    }
  }

  function drawActor(sprites, x, feet, now, opts = {}) {
    const { idle, attack } = sprites;
    const { attackAt = -9, flip = false, lunge = 0, size = 16 } = opts;
    const since = now - attackAt;
    if (attack && since >= 0 && since < attack.frames.length / attack.fps) {
      drawSprite(g, attack, Math.floor(since * attack.fps), x, feet - attack.h, { flip });
      return;
    }
    const dx = since >= 0 && since < 0.15 ? lunge : 0;
    if (idle) drawSprite(g, idle, frameAt(idle, now), x + dx, feet - idle.h, { flip });
    else drawPlaceholder(g, x + dx, feet - size, size, size, pal);
  }

  function bar(x, y, w, ratio, color) {
    g.fillStyle = col('0'); g.fillRect(x - 1, y - 1, w + 2, 4);
    g.fillStyle = col('1'); g.fillRect(x, y, w, 2);
    g.fillStyle = color; g.fillRect(x, y, Math.max(0, Math.round(w * ratio)), 2);
  }

  function draw(state, now) {
    g.clearRect(0, 0, SCENE_W, SCENE_H);
    // 10階層ごとに背景が変わる（変わるときは暗転を挟む）
    const { shown: stage, dark } = stageFade(stageFor(state.adventure.floor, app.stages), now);
    if (stage && stage.bg) drawSprite(g, stage.bg, 0, 0, 0);
    else { g.fillStyle = col('o', '#a6d8f2'); g.fillRect(0, 0, SCENE_W, SCENE_H); g.fillStyle = col('j', '#6fb042'); g.fillRect(0, 98, SCENE_W, 62); }

    // 仲間と主人公（奥から順に描く）。中ボスだった仲間は左向きに描かれているので左右反転して右向きにする。
    // 契約した仲間は最初から右向き
    const actors = partyAllies(state).slice(0, ALLY_SLOTS.length).map((ally, i) => ({ ally, ...ALLY_SLOTS[i] }));
    actors.push({ hero: true, x: X.hero, feet: FEET_Y });
    actors.sort((a, b) => a.feet - b.feet);
    for (const a of actors) {
      if (a.hero) {
        // 主人公（ひらめきの間は少し光る）
        drawActor({ idle: app.heroSprites.idle, attack: app.heroSprites.attack }, X.hero, FEET_Y, now, { attackAt: anim.heroAt, lunge: 2 });
        continue;
      }
      const sp = a.ally.hired ? (app.recruitSprites || {})[a.ally.id] || {} : { idle: spriteOf(a.ally.id, 'idle'), attack: spriteOf(a.ally.id, 'attack') };
      drawActor({ idle: sp.idle || null, attack: sp.attack || null }, a.x, a.feet, now, { attackAt: allyAt.get(a.ally.id) ?? -9, flip: !a.ally.hired, lunge: 2 });
    }
    if (now - anim.spellAt < 0.25) {
      g.fillStyle = col('g');
      for (const [dx, dy] of [[0, -2], [16, 2], [-2, 10], [17, 12], [8, -4]]) g.fillRect(X.hero + dx, FEET_Y - 16 + dy, 1, 1);
    }

    // 敵の群れ（奥から順に描く）
    const enemies = state.adventure.enemies;
    const enter = Math.min(1, (now - anim.spawnAt) / 0.35);
    const boxes = new Map(enemies.map((e) => [e, enemyBox(e.monsterId, e.slot)]));
    const order = [...enemies].sort((a, b) => boxes.get(a).feet - boxes.get(b).feet);
    for (const e of order) {
      const p = boxes.get(e);
      const shake = now - (enemyHitAt.get(e.uid) ?? -9) < 0.1 ? 1 : 0;
      const x = p.x + Math.round((1 - enter) * 40) + shake;
      drawActor({ idle: spriteOf(e.monsterId, 'idle'), attack: spriteOf(e.monsterId, 'attack') }, x, p.feet, now, { attackAt: enemyAttackAt.get(e.uid) ?? -9, lunge: -3, size: p.w });
    }
    // 倒れた敵（点滅して消える）
    for (let i = dying.length - 1; i >= 0; i--) {
      const d = dying[i];
      const t = now - d.t0;
      if (t > 0.4) { dying.splice(i, 1); continue; }
      if (Math.floor(t * 20) % 2 === 0) { const p = enemyBox(d.monsterId, d.slot); drawActor({ idle: spriteOf(d.monsterId, 'idle') }, p.x, p.feet, now, { size: p.w }); }
    }
    // HPバーと、狙っている敵の印（▼）
    for (const e of enemies) {
      const p = boxes.get(e);
      bar(p.x + 2, p.top - 4, p.w - 4, e.hp / e.maxHp, isInvulnerable(state, e) ? col('3') : col('d'));
    }
    if (enemies.length > 1 && enter >= 1) {
      const p = boxes.get(enemies[0]);
      const mx = Math.round(p.cx);
      g.fillStyle = col('4');
      g.fillRect(mx - 2, p.top - 10, 5, 1);
      g.fillRect(mx - 1, p.top - 9, 3, 1);
      g.fillRect(mx, p.top - 8, 1, 1);
    }

    const hs = heroStats(state, app.ctx);
    bar(X.hero, FEET_Y - 20, 16, state.hero.hp / hs.maxHp, col('j'));

    // エフェクト
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      const t = now - f.t0;
      if (f.type === 'num') {
        if (t > 0.9) { fx.splice(i, 1); continue; }
        if (t > 0.7 && Math.floor(t * 30) % 2) continue;
        drawNumber(f.text, f.x, f.y - Math.min(8, t * 18), f.color);
      } else if (f.type === 'slash') {
        if (t > 0.18) { fx.splice(i, 1); continue; }
        const n = Math.min(9, Math.floor(t / 0.12 * 9));
        g.fillStyle = col(f.crit ? 'f' : t > 0.12 ? 'o' : '4');
        const sx = Math.round(f.cx) + 5, sy = Math.round(f.cy) - 6;
        for (let k = 0; k <= n; k++) {
          g.fillRect(sx - k, sy + k, 1, 1);
          if (f.crit) g.fillRect(sx + 1 - k, sy + k, 1, 1);
        }
      } else if (f.type === 'burst') {
        if (t > 0.35) { fx.splice(i, 1); continue; }
        const r = (f.big ? 3 : 2) + Math.floor(t * (f.big ? 30 : 20));
        g.fillStyle = col(f.big ? (t > 0.2 ? 'f' : 'g') : (t > 0.2 ? 'n' : 'o'));
        const cx = Math.round(f.cx), cy = Math.round(f.cy);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          g.fillRect(cx + dx * r, cy + dy * r, 1, 1);
          g.fillRect(cx + dx * (r - 1), cy + dy * (r - 1), 1, 1);
        }
      }
    }
    // 暗転（キャンバスの上に黒を重ねる。ステータスの表示はキャンバスの外なので暗くならない）
    if (dark > 0) {
      g.globalAlpha = dark;
      g.fillStyle = '#000';
      g.fillRect(0, 0, SCENE_W, SCENE_H);
      g.globalAlpha = 1;
    }
  }

  return { draw, onEvents };
}
