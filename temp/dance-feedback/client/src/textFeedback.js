import { RATINGS } from './ratings.js';
import { TEXT_DESIGNS, sparkle } from './designs.js';

/*
 * Minimal move ratings in the top-left corner. Shared timing and motion for every
 * design (pop-in, Perfect slam, Miss shake then letters falling apart, a few twinkles for
 * Perfect), with the look supplied by a design from designs.js. Kept minimal: no sunbursts, star bursts or droplets.
 *
 *   const fb = createTextFeedback();
 *   fb.setDesign(index); fb.trigger('great', now); fb.draw(ctx, now);
 */

const ANCHOR = { x: 64, y: 34 };
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeOut = (t) => 1 - (1 - t) ** 3;
const backOut = (t, s = 2.2) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;
const SIZES = { perfect: 92, great: 92, good: 86, ok: 78, miss: 92 };
const COMBO_PALETTE = { top: '#eafcff', mid: '#58d8ff', bottom: '#1a7fd6', outline: '#0b3d73' };
const OUT = { miss: 0.6 };
const TWINKLES = { perfect: 3 };

export function createTextFeedback() {
  let design = TEXT_DESIGNS[0];
  let hold = false; // keep each rating up until the next one (for reviewing)
  const pops = [];
  const combo = { n: 0, bump: -10, broken: -10, lost: 0 };
  const measure = document.createElement('canvas').getContext('2d');
  // Canvas text only uses a web font once it has loaded; ask for every design's face up front.
  for (const d of TEXT_DESIGNS) document.fonts?.load(d.font(64)).catch(() => {});

  const lead = (size) => design.lead?.(size) ?? 0;

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

  function prepare(label, size, R, type, now, age, small, leave = 0) {
    const { letters, width } = layout(label, size);
    return {
      R, type, size, font: design.font(size), x: ANCHOR.x + lead(size), y: ANCHOR.y + size * 0.82, width, now, age, small, leave,
      enter: clamp01(age / 0.32), rainbow: type === 'perfect',
      letters: letters.map((l) => ({ ...l, dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, alpha: 1 })),
    };
  }

  function trigger(type, now) {
    const R = RATINGS[type];
    for (const p of pops) p.leaveAt = Math.min(p.leaveAt, now + 0.08);
    const size = SIZES[type] * design.scale;
    const { width } = layout(R.label, size);
    const x0 = ANCHOR.x + lead(size);
    const top = ANCHOR.y + size * 0.1;
    // A few crisp twinkles along the top edge of the word, one after another.
    const n = TWINKLES[type] ?? 0;
    const particles = Array.from({ length: n }, (_, i) => ({
      x: x0 + width * ((i + 0.5) / n) + (Math.random() - 0.5) * width * 0.12,
      y: top + (i % 2 ? size * 0.12 : -size * 0.04),
      r: size * (0.14 + Math.random() * 0.08),
      delay: 0.12 + i * 0.09,
      life: 0.5,
    }));
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
    const P = prepare(R.label, size, R, p.type, now, age, false, k);

    let scale = 1;
    let dx = 0;
    let dy = 0;
    let alpha = 1;
    if (p.type === 'perfect') {
      scale = 1.3 - 0.3 * backOut(clamp01(age / 0.22), 1.4);
    } else if (p.type === 'miss') {
      scale = 0.2 + 0.8 * backOut(clamp01(age / 0.18), 1.2);
      dx = Math.sin(age * 70) * 9 * Math.exp(-age * 7);
      // On the way out the letters come apart and tumble down one after another.
      P.letters.forEach((l, i) => {
        const f = clamp01(k * 1.4 - i * 0.08);
        l.dy += 300 * f * f;
        l.rot += (i % 2 ? 1 : -1) * 0.8 * f;
        l.alpha *= 1 - f;
      });
    } else {
      scale = 0.35 + 0.65 * backOut(clamp01(age / 0.24), p.type === 'ok' ? 1 : 2);
    }
    if (out > 0 && p.type !== 'miss') {
      dy -= 26 * easeOut(k);
      scale *= 1 - 0.08 * k;
    }
    if (p.type !== 'miss') alpha = 1 - k;
    design.letters?.(P.letters, P);

    const cx = P.x + P.width / 2;
    const cy = P.y - size * 0.36;
    g.save();
    g.globalAlpha = alpha;
    // Scale from the corner anchor: the label is pinned to the corner and grows into the screen.
    const px = ANCHOR.x;
    g.translate(px + dx, cy + dy);
    g.scale(scale, scale);
    g.translate(-px, -cy);
    design.transform?.(g, P, cx, cy);
    design.draw(g, P);
    g.restore();

    for (const q of p.particles) {
      const f = (age - q.delay) / q.life;
      if (f < 0 || f > 1) continue;
      sparkle(g, q.x, q.y, q.r * Math.sin(f * Math.PI), '#ffffff', alpha);
    }
    return true;
  }

  function drawCombo(g, now) {
    const y0 = ANCHOR.y + 92 * design.scale + 30 + (design.comboGap ?? 0);
    if (combo.n >= 2) {
      const k = clamp01((now - combo.bump) / 0.25);
      const s = 1 + 0.2 * (1 - k) * (1 - k);
      const size = 40;
      const P = prepare(`×${combo.n} COMBO`, size, COMBO_PALETTE, 'combo', now, 10, true);
      P.y = y0 + size * 0.82;
      P.x = ANCHOR.x + 6 + lead(size);
      const cx = ANCHOR.x;
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
      const P = prepare(`×${combo.lost} COMBO BROKEN`, size, RATINGS.miss, 'broken', now, 10, true);
      P.y = y0 + size * 0.82 + since * 10;
      P.x = ANCHOR.x + 6 + lead(size) + Math.sin(since * 50) * 4 * Math.exp(-since * 6);
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
