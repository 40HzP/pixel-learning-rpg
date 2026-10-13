// 冒険画面の描画（90×160 のキャンバス）。攻撃エフェクト・ダメージ数字・HPバーはここで描く。
import { drawSprite, drawPlaceholder, frameAt, cssColor } from './sprites.js';
import { heroStats, isInvulnerable } from './sim.js';

export const SCENE_W = 90;
export const SCENE_H = 160;
const FEET_Y = 136;                       // 足元の高さ（style-guide：キャラクターは y=105〜150 に立つ）
const X = { ally: 3, hero: 21, enemy: 55 };

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
  const anim = { heroAt: -9, allyAt: -9, enemyAt: -9, hitAt: -9, spawnAt: -9, dying: null };

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
    // 速さ×60などで数字が重なりすぎないように、同時に出すのは3つまで
    const nums = fx.filter((x) => x.type === 'num');
    if (nums.length >= 3) fx.splice(fx.indexOf(nums[0]), 1);
    fx.push({ type: 'num', ...f });
  }

  function onEvents(events, now) {
    for (const e of events) {
      if (e.type === 'attack' && e.target === 'enemy') {
        if (e.by === 'hero') anim.heroAt = now;
        if (e.by === 'ally') anim.allyAt = now;
        anim.hitAt = now;
        const big = e.by === 'quiz';
        addNumber({ text: String(e.dmg), x: X.enemy + 8, y: FEET_Y - 22, t0: now, color: e.dmg === 0 ? col('3') : big ? col('g') : col('4') });
        fx.push({ type: big ? 'burst' : 'slash', x: X.enemy, y: FEET_Y - 16, t0: now });
      } else if (e.type === 'attack' && e.target === 'hero') {
        anim.enemyAt = now;
        addNumber({ text: String(e.dmg), x: X.hero + 8, y: FEET_Y - 22, t0: now, color: col('d') });
      } else if (e.type === 'heal' && e.amount > 0) {
        addNumber({ text: '+' + e.amount, x: X.enemy + 8, y: FEET_Y - 26, t0: now, color: col('j') });
      } else if (e.type === 'spawn') {
        anim.spawnAt = now;
      } else if (e.type === 'defeat') {
        anim.dying = { id: e.monsterId, t0: now };
      }
    }
  }

  function drawActor(sprites, x, now, opts = {}) {
    const { idle, attack, attackAt = -9, flip = false, lunge = 0 } = { ...sprites, ...opts };
    const atkSprite = attack || null;
    const since = now - attackAt;
    if (atkSprite && since >= 0 && since < atkSprite.frames.length / atkSprite.fps) {
      const i = Math.floor(since * atkSprite.fps);
      drawSprite(g, atkSprite, i, x, FEET_Y - atkSprite.h, { flip });
      return;
    }
    const dx = since >= 0 && since < 0.15 ? lunge : 0;
    if (idle) drawSprite(g, idle, frameAt(idle, now), x + dx, FEET_Y - idle.h, { flip });
    else drawPlaceholder(g, x + dx, FEET_Y - 16, 16, 16, pal);
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
      drawActor({ idle: spriteOf(ally.id, 'idle'), attack: spriteOf(ally.id, 'attack') }, X.ally, now, { attackAt: anim.allyAt, flip: true, lunge: 2 });
    }

    // 主人公
    drawActor({ idle: app.heroSprites.idle, attack: app.heroSprites.attack }, X.hero, now, { attackAt: anim.heroAt, lunge: 2 });

    // 敵
    const e = state.adventure.enemy;
    if (e) {
      const enter = Math.min(1, (now - anim.spawnAt) / 0.35);
      const shake = now - anim.hitAt < 0.1 ? 1 : 0;
      const x = X.enemy + Math.round((1 - enter) * 40) + shake;
      drawActor({ idle: spriteOf(e.monsterId, 'idle'), attack: spriteOf(e.monsterId, 'attack') }, x, now, { attackAt: anim.enemyAt, lunge: -3 });
      bar(X.enemy, FEET_Y - 20, 16, e.hp / e.maxHp, isInvulnerable(state, e) ? col('3') : col('d'));
    }
    // 倒れた敵（点滅して消える）
    if (anim.dying && now - anim.dying.t0 < 0.4) {
      if (Math.floor((now - anim.dying.t0) * 20) % 2 === 0) {
        drawActor({ idle: spriteOf(anim.dying.id, 'idle') }, X.enemy, now);
      }
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
        g.fillStyle = col(t > 0.12 ? 'o' : '4');
        for (let k = 0; k <= n; k++) g.fillRect(f.x + 13 - k, f.y + 2 + k, 1, 1);
      } else if (f.type === 'burst') {
        if (t > 0.35) { fx.splice(i, 1); continue; }
        const r = 3 + Math.floor(t * 30);
        g.fillStyle = col(t > 0.2 ? 'f' : 'g');
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
