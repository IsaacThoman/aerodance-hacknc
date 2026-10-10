import { RATINGS, drawParticle, spawnParticles } from './ratings.js';
import { FONT, TEXT_DESIGNS, sparkle } from './designs.js';

/*
 * Text-only move ratings in the top-left corner. Shared timing and motion for every
 * design (pop-in, Perfect slam + sunburst, Miss shake then letters falling apart,
 * Not even trying drooping), with the look supplied by a design from designs.js.
 *
 *   const fb = createTextFeedback();
 *   fb.setDesign(index); fb.trigger('great', now); fb.draw(ctx, now);
 */

const ANCHOR = { x: 64, y: 34 };
const TAU = Math.PI * 2;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeOut = (t) => 1 - (1 - t) ** 3;
const backOut = (t, s = 2.2) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;
const SIZES = { perfect: 92, great: 92, good: 86, ok: 78, miss: 92, lazy: 56 };
const COMBO_PALETTE = { top: '#eafcff', mid: '#58d8ff', bottom: '#1a7fd6', outline: '#0b3d73' };
const OUT = { miss: 0.6, lazy: 0.6 };

export function createTextFeedback() {
  let design = TEXT_DESIGNS[0];
  let hold = false; // keep each rating up until the next one (for reviewing)
  const pops = [];
  const combo = { n: 0, bump: -10, broken: -10, lost: 0 };
  const measure = document.createElement('canvas').getContext('2d');

  function layout(label, size, d = design) {
    measure.font = d.font(size);
    const track = d.tracking * size;
    const letters = [];
    let x = 0;
    for (const ch of label) {
      const w = measure.measureText(ch).width;
      letters.push({ ch, x, w });
      x += w + track;
    }
    return { letters, width: x - track };
  }

  function prepare(label, size, R, type, now, age, small) {
    const { letters, width } = layout(label, size);
    return {
      R, type, size, font: design.font(size), x: ANCHOR.x, y: ANCHOR.y + size * 0.82, width, now, age, small,
      enter: clamp01(age / 0.32), glint: (age - 0.15) / 0.45, rainbow: type === 'perfect',
      letters: letters.map((l) => ({ ...l, dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, alpha: 1 })),
    };
  }

  function trigger(type, now) {
    const R = RATINGS[type];
    for (const p of pops) p.leaveAt = Math.min(p.leaveAt, now + 0.08);
    const size = SIZES[type] * design.scale;
    const { width } = layout(R.label, size);
    const cx = ANCHOR.x + width / 2;
    const cy = ANCHOR.y + size * 0.45;
    // Sparkles instead of bubbles; stars for Perfect, droplets for Miss.
    let particles = [];
    if (R.particles === 'stars' || R.particles === 'drops') particles = spawnParticles(type, cx, cy, width, size);
    else if (R.particles === 'bubbles') {
      particles = Array.from({ length: Math.ceil(R.count * 0.7) }, () => ({
        kind: 'glint', x: cx + (Math.random() - 0.5) * width, y: cy + (Math.random() - 0.5) * size * 0.8,
        vx: (Math.random() - 0.5) * 120, vy: -60 - Math.random() * 90, r: 10 + Math.random() * 12, life: 0.5 + Math.random() * 0.4,
      }));
    }
    pops.push({ type, born: now, leaveAt: hold ? Infinity : now + R.hold, particles });
    if (pops.length > 3) pops.shift();
    if (R.combo) { combo.n += 1; combo.bump = now; } else if (combo.n > 0) {
      combo.lost = combo.n;
      combo.n = 0;
      combo.broken = now;
    }
  }

  function drawPop(g, p, now) {
    const R = RATINGS[p.type];
    const age = now - p.born;
    const out = Math.max(0, now - p.leaveAt);
    const outLen = OUT[p.type] ?? 0.25;
    if (out > outLen) return false;
    const k = out / outLen;
    const size = SIZES[p.type] * design.scale;
    const P = prepare(R.label, size, R, p.type, now, age, false);

    let scale = 1;
    let rot = 0;
    let dx = 0;
    let dy = 0;
    let alpha = 1;
    if (p.type === 'perfect') {
      scale = 1.4 - 0.4 * backOut(clamp01(age / 0.22), 1.4);
    } else if (p.type === 'miss') {
      scale = 0.2 + 0.8 * backOut(clamp01(age / 0.18), 1.2);
      dx = Math.sin(age * 70) * 9 * Math.exp(-age * 7);
      P.glint = -1;
      // On the way out the letters come apart and tumble down one after another.
      P.letters.forEach((l, i) => {
        const f = clamp01(k * 1.4 - i * 0.08);
        l.dy += 300 * f * f;
        l.rot += (i % 2 ? 1 : -1) * 0.8 * f;
        l.alpha *= 1 - f;
      });
    } else if (p.type === 'lazy') {
      const e = easeOut(clamp01(age / 0.5));
      scale = 0.85 + 0.15 * e;
      rot = -0.04 * e;
      dy = 6 * e;
      P.glint = -1;
      const sag = clamp01((age - 0.3) / 0.6);
      P.letters.forEach((l, i) => {
        l.dy += i * sag * 1.4 + Math.sin(i * 0.9 + now * 2) * 2;
        l.rot += sag * 0.05 * Math.sin(i + now);
        l.sy *= 1 - 0.35 * k;
        l.dy += 24 * k;
      });
    } else {
      scale = 0.35 + 0.65 * backOut(clamp01(age / 0.24), p.type === 'ok' ? 1 : 2);
    }
    if (out > 0 && p.type !== 'miss' && p.type !== 'lazy') {
      dy -= 26 * easeOut(k);
      scale *= 1 - 0.08 * k;
    }
    if (p.type !== 'miss') alpha = 1 - k;
    design.letters?.(P.letters, P);

    const cx = P.x + P.width / 2;
    const cy = P.y - size * 0.36;
    g.save();
    g.globalAlpha = alpha;
    if (p.type === 'perfect') {
      // Sunburst behind the word.
      const show = clamp01(age / 0.15);
      g.save();
      g.translate(cx, cy);
      g.rotate(now * 0.8);
      g.globalAlpha = alpha * 0.5 * show;
      for (let i = 0; i < 14; i++) {
        g.rotate(TAU / 14);
        const len = P.width * 0.62 + Math.sin(now * 5 + i) * 18;
        const ray = g.createLinearGradient(0, 0, len, 0);
        ray.addColorStop(0, 'rgba(255, 236, 140, 0.9)');
        ray.addColorStop(1, 'rgba(255, 236, 140, 0)');
        g.fillStyle = ray;
        g.beginPath();
        g.moveTo(0, -10);
        g.lineTo(len, 0);
        g.lineTo(0, 10);
        g.fill();
      }
      g.restore();
    }
    // Scale from the left edge: the label is pinned to the corner and grows into the screen.
    const px = P.x;
    g.translate(px + dx, cy + dy);
    g.rotate(rot);
    g.scale(scale, scale);
    g.translate(-px, -cy);
    design.transform?.(g, P, cx, cy);
    design.draw(g, P);
    g.restore();

    for (const q of p.particles) {
      if (age > q.life) continue;
      if (q.kind === 'glint') {
        const f = age / q.life;
        sparkle(g, q.x + q.vx * age, q.y + q.vy * age, q.r * Math.sin(f * Math.PI), '#ffffff', 1 - f * f);
        continue;
      }
      const grav = q.kind === 'drop' ? 900 : 220;
      const drag = q.kind === 'star' ? 2.2 : 0.6;
      const kk = (1 - Math.exp(-drag * age)) / drag;
      drawParticle(g, { ...q, x: q.x + q.vx * kk, y: q.y + q.vy * kk + 0.5 * grav * age * age, vy: q.vy + grav * age }, age);
    }

    if (p.type === 'lazy') {
      for (let i = 0; i < 3; i++) {
        const za = age - i * 0.35;
        if (za < 0) continue;
        const zk = (za % 1.4) / 1.4;
        g.save();
        g.globalAlpha = alpha * (1 - zk) * clamp01(za * 4);
        g.fillStyle = '#ffffff';
        g.strokeStyle = '#3a434c';
        g.lineWidth = 5;
        g.font = `italic 900 ${24 + i * 8}px ${FONT}`;
        const zx = P.x + P.width + 14 + zk * 50 + i * 18;
        const zy = P.y - size * 0.5 - zk * 22 - i * 6;
        g.strokeText('z', zx, zy);
        g.fillText('z', zx, zy);
        g.restore();
      }
    }
    return true;
  }

  function drawCombo(g, now) {
    const y0 = ANCHOR.y + 92 * design.scale + 30;
    if (combo.n >= 2) {
      const k = clamp01((now - combo.bump) / 0.25);
      const s = 1 + 0.2 * (1 - k) * (1 - k);
      const size = 40;
      const P = prepare(`×${combo.n} COMBO`, size, COMBO_PALETTE, 'combo', now, 10, true);
      P.y = y0 + size * 0.82;
      P.x = ANCHOR.x + 6;
      const cx = P.x;
      const cy = P.y - size * 0.35;
      g.save();
      g.translate(cx, cy);
      g.scale(s, s);
      g.translate(-cx, -cy);
      design.draw(g, P);
      g.restore();
    }
    const since = now - combo.broken;
    if (since >= 0 && since < 1.3 && combo.lost >= 2) {
      const size = 32;
      const P = prepare(`×${combo.lost} COMBO BROKEN`, size, RATINGS.miss, 'combo', now, 10, true);
      P.y = y0 + size * 0.82 + since * 10;
      P.x = ANCHOR.x + 6 + Math.sin(since * 50) * 4 * Math.exp(-since * 6);
      g.save();
      g.globalAlpha = 1 - clamp01((since - 0.8) / 0.5);
      design.draw(g, P);
      g.restore();
    }
  }

  function draw(g, now) {
    for (let i = 0; i < pops.length; i++) {
      if (!drawPop(g, pops[i], now)) { pops.splice(i, 1); i--; }
    }
    drawCombo(g, now);
  }

  /** One rating frozen just after it settles, at an offset (for the gallery view). */
  function drawSample(g, type, now, ox, oy) {
    g.save();
    g.translate(ox, oy);
    drawPop(g, { type, born: now - 0.75, leaveAt: Infinity, particles: [] }, now);
    g.restore();
  }

  return {
    trigger,
    draw,
    drawSample,
    combo,
    setDesign(i) { design = TEXT_DESIGNS[i] ?? design; },
    setHold(on) { hold = on; },
  };
}
