// 冒険画面の描画（90×160 のキャンバス）。攻撃エフェクト・ダメージ数字・HPバーはここで描く。
import { drawSprite, drawPlaceholder, frameAt, cssColor } from './sprites.js';
import { heroStats, isInvulnerable } from './sim.js';

export const SCENE_W = 90;
export const SCENE_H = 160;
const FEET_Y = 136;                       // 主人公の足元（style-guide：キャラクターは y=105〜150 に立つ）
const X = { ally: 3, hero: 21 };

// 敵の群れの並び（群れの中の番号 slot → 絵の左端 x と足元 y）。先頭（slot 0）がいちばん手前
const FORMATION = [
  { x: 47, feet: 138 },
  { x: 61, feet: 127 },
  { x: 62, feet: 151 },
  { x: 74, feet: 139 },
  { x: 74, feet: 117 },
];
const slotPos = (slot) => FORMATION[(slot || 0) % FORMATION.length];

// 3×5 のドット数字（ダメージ表示用）
const DIGITS = {
  0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'], 3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '001', '010', '010'],
  8: ['111', '101', '111', '101', '111'], 9: ['111', '101', '111', '001', '111'],
  '+': ['000', '010', '111', '010', '000'],
};

export function createRenderer(canvas, app) {
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  const pal = app.palette;
  const col = (k, fallback) => cssColor(pal, k, fallback);
  const fx = [];
  const anim = { heroAt: -9, allyAt: -9, spellAt: -9, spawnAt: -9 };
  const enemyAttackAt = new Map(); // uid → 時刻
  const enemyHitAt = new Map();    // uid → 時刻
  const dying = [];                // { monsterId, slot, t0 }

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

  function addNumber(f) {
    // 数字が重なりすぎないように、同時に出すのは4つまで
    const nums = fx.filter((x) => x.type === 'num');
    if (nums.length >= 4) fx.splice(fx.indexOf(nums[0]), 1);
    fx.push({ type: 'num', ...f });
  }

  function onEvents(events, now) {
    for (const e of events) {
      if (e.type === 'attack' && e.target === 'enemy') {
        const p = slotPos(e.slot);
        if (e.by === 'hero') anim.heroAt = now;
        if (e.by === 'ally') anim.allyAt = now;
        enemyHitAt.set(e.uid, now);
        const color = e.dmg === 0 ? col('3') : e.by === 'quiz' ? col('g') : e.crit ? col('e') : e.by === 'spell' ? col('o') : col('4');
        addNumber({ text: String(e.dmg), x: p.x + 8, y: p.feet - 22, t0: now, color });
        if (e.by === 'quiz' || e.by === 'spell') fx.push({ type: 'burst', x: p.x, y: p.feet - 16, t0: now, big: e.by === 'quiz' });
        else fx.push({ type: 'slash', x: p.x, y: p.feet - 16, t0: now, crit: !!e.crit });
      } else if (e.type === 'attack' && e.target === 'hero') {
        enemyAttackAt.set(e.uid, now);
        addNumber({ text: String(e.dmg), x: X.hero + 8, y: FEET_Y - 22, t0: now, color: col('d') });
      } else if (e.type === 'heal' && e.amount > 0) {
        const p = slotPos(e.slot);
        addNumber({ text: '+' + e.amount, x: p.x + 8, y: p.feet - 26, t0: now, color: col('j') });
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
    const { attackAt = -9, flip = false, lunge = 0 } = opts;
    const since = now - attackAt;
    if (attack && since >= 0 && since < attack.frames.length / attack.fps) {
      drawSprite(g, attack, Math.floor(since * attack.fps), x, feet - attack.h, { flip });
      return;
    }
    const dx = since >= 0 && since < 0.15 ? lunge : 0;
    if (idle) drawSprite(g, idle, frameAt(idle, now), x + dx, feet - idle.h, { flip });
    else drawPlaceholder(g, x + dx, feet - 16, 16, 16, pal);
  }

  function bar(x, y, w, ratio, color) {
    g.fillStyle = col('0'); g.fillRect(x - 1, y - 1, w + 2, 4);
    g.fillStyle = col('1'); g.fillRect(x, y, w, 2);
    g.fillStyle = color; g.fillRect(x, y, Math.max(0, Math.round(w * ratio)), 2);
  }

  function draw(state, now) {
    g.clearRect(0, 0, SCENE_W, SCENE_H);
    if (app.bg) drawSprite(g, app.bg, 0, 0, 0);
    else { g.fillStyle = col('o', '#a6d8f2'); g.fillRect(0, 0, SCENE_W, SCENE_H); g.fillStyle = col('j', '#6fb042'); g.fillRect(0, 98, SCENE_W, 62); }

    // 仲間（中ボスは左向きに描かれているので左右反転して右向きにする）
    for (const ally of state.allies) {
      drawActor({ idle: spriteOf(ally.id, 'idle'), attack: spriteOf(ally.id, 'attack') }, X.ally, FEET_Y, now, { attackAt: anim.allyAt, flip: true, lunge: 2 });
    }

    // 主人公（ひらめきの間は少し光る）
    drawActor({ idle: app.heroSprites.idle, attack: app.heroSprites.attack }, X.hero, FEET_Y, now, { attackAt: anim.heroAt, lunge: 2 });
    if (now - anim.spellAt < 0.25) {
      g.fillStyle = col('g');
      for (const [dx, dy] of [[0, -2], [16, 2], [-2, 10], [17, 12], [8, -4]]) g.fillRect(X.hero + dx, FEET_Y - 16 + dy, 1, 1);
    }

    // 敵の群れ（奥から順に描く）
    const enemies = state.adventure.enemies;
    const enter = Math.min(1, (now - anim.spawnAt) / 0.35);
    const order = [...enemies].sort((a, b) => slotPos(a.slot).feet - slotPos(b.slot).feet);
    for (const e of order) {
      const p = slotPos(e.slot);
      const shake = now - (enemyHitAt.get(e.uid) ?? -9) < 0.1 ? 1 : 0;
      const x = p.x + Math.round((1 - enter) * 40) + shake;
      drawActor({ idle: spriteOf(e.monsterId, 'idle'), attack: spriteOf(e.monsterId, 'attack') }, x, p.feet, now, { attackAt: enemyAttackAt.get(e.uid) ?? -9, lunge: -3 });
    }
    // 倒れた敵（点滅して消える）
    for (let i = dying.length - 1; i >= 0; i--) {
      const d = dying[i];
      const t = now - d.t0;
      if (t > 0.4) { dying.splice(i, 1); continue; }
      if (Math.floor(t * 20) % 2 === 0) { const p = slotPos(d.slot); drawActor({ idle: spriteOf(d.monsterId, 'idle') }, p.x, p.feet, now); }
    }
    // HPバーと、狙っている敵の印（▼）
    for (const e of enemies) {
      const p = slotPos(e.slot);
      bar(p.x + 2, p.feet - 20, 12, e.hp / e.maxHp, isInvulnerable(state, e) ? col('3') : col('d'));
    }
    if (enemies.length > 1 && enter >= 1) {
      const p = slotPos(enemies[0].slot);
      g.fillStyle = col('4');
      g.fillRect(p.x + 6, p.feet - 26, 5, 1);
      g.fillRect(p.x + 7, p.feet - 25, 3, 1);
      g.fillRect(p.x + 8, p.feet - 24, 1, 1);
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
        for (let k = 0; k <= n; k++) {
          g.fillRect(f.x + 13 - k, f.y + 2 + k, 1, 1);
          if (f.crit) g.fillRect(f.x + 14 - k, f.y + 2 + k, 1, 1);
        }
      } else if (f.type === 'burst') {
        if (t > 0.35) { fx.splice(i, 1); continue; }
        const r = (f.big ? 3 : 2) + Math.floor(t * (f.big ? 30 : 20));
        g.fillStyle = col(f.big ? (t > 0.2 ? 'f' : 'g') : (t > 0.2 ? 'n' : 'o'));
        const cx = f.x + 8, cy = f.y + 8;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          g.fillRect(cx + dx * r, cy + dy * r, 1, 1);
          g.fillRect(cx + dx * (r - 1), cy + dy * (r - 1), 1, 1);
        }
      }
    }
  }

  return { draw, onEvents };
}
