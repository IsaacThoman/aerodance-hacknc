/*
 * Five text-only looks for the move ratings, all Frutiger Aero. Each design gets a prepared
 * label `P` (letters already laid out and animated by textFeedback.js) and paints it:
 *
 *   P = { R, type, size, font, x, y (baseline), width, letters[], now, age,
 *         enter (0..1 entry progress), glint (0..1 sweep, else off), rainbow, small }
 *
 * Optional hooks: letters(letters, P) for per-letter motion, transform(g, P, cx, cy) for
 * an extra whole-label transform.
 */

export const FONT = '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif';
const TAU = Math.PI * 2;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeOut = (t) => 1 - (1 - t) ** 3;

/* ------------------------------------------------------------------ helpers */

let off = null;
/** Paint into a scratch canvas with the same transform, then composite it back. Lets a
 *  design use 'source-atop' tricks (gloss, caustics) that only land on the letters. */
export function layer(g, fn) {
  const c = g.canvas;
  if (!off || off.width !== c.width || off.height !== c.height) {
    off = document.createElement('canvas');
    off.width = c.width;
    off.height = c.height;
  }
  const o = off.getContext('2d');
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.globalCompositeOperation = 'source-over';
  o.globalAlpha = 1;
  o.clearRect(0, 0, off.width, off.height);
  o.setTransform(g.getTransform());
  o.textBaseline = 'alphabetic';
  o.lineJoin = 'round';
  fn(o);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(off, 0, 0);
  g.restore();
}

/** Call fn(char, x, y) for each letter with its own offset, rotation, scale and alpha. */
export function eachLetter(c, P, fn) {
  const base = c.globalAlpha;
  for (const l of P.letters) {
    if (l.alpha <= 0.01) continue;
    c.save();
    c.translate(P.x + l.x + l.w / 2 + l.dx, P.y + l.dy);
    c.rotate(l.rot);
    c.scale(l.sx, l.sy);
    c.globalAlpha = base * l.alpha;
    fn(l.ch, -l.w / 2, 0, l);
    c.restore();
  }
}

const strokeAll = (c, P) => eachLetter(c, P, (ch, x, y) => c.strokeText(ch, x, y));
const fillAll = (c, P) => eachLetter(c, P, (ch, x, y) => c.fillText(ch, x, y));

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.round(Math.min(255, Math.max(0, v * f))).toString(16).padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const RAINBOW = ['#ff6ad5', '#ffd23f', '#a8ff5a', '#56f4ff', '#b48cff'];

/** Horizontal rainbow that scrolls with time (repeats twice so the scroll is seamless). */
function rainbowGradient(c, P, colors = RAINBOW, speed = 0.5) {
  const w = Math.max(P.width, 1);
  const shift = ((P.now * speed) % 1) * w;
  const grad = c.createLinearGradient(P.x - w + shift, 0, P.x + w + shift, 0);
  const list = [...colors, ...colors, colors[0]];
  list.forEach((col, i) => grad.addColorStop(i / (list.length - 1), col));
  return grad;
}

function verticalGradient(c, P, stops) {
  const top = P.y - P.size * 0.76;
  const bot = P.y + P.size * 0.04;
  const grad = c.createLinearGradient(0, top, 0, bot);
  stops.forEach(([t, col]) => grad.addColorStop(t, col));
  return grad;
}

/** Diagonal white band sweeping across the letters (call inside a source-atop layer). */
function glint(c, P, alpha = 0.8) {
  if (!(P.glint >= 0 && P.glint <= 1)) return;
  const top = P.y - P.size;
  const bot = P.y + P.size * 0.2;
  const gx = P.x - 140 + (P.width + 280) * easeOut(P.glint);
  const band = c.createLinearGradient(gx - 70, 0, gx + 70, 0);
  band.addColorStop(0, 'rgba(255,255,255,0)');
  band.addColorStop(0.5, `rgba(255,255,255,${alpha})`);
  band.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = band;
  c.beginPath();
  c.moveTo(gx - 30, top);
  c.lineTo(gx + 60, top);
  c.lineTo(gx + 10, bot);
  c.lineTo(gx - 80, bot);
  c.closePath();
  c.fill();
}

/** Four-point lens sparkle. */
export function sparkle(c, x, y, r, color = '#ffffff', alpha = 1) {
  if (r <= 0.5 || alpha <= 0.01) return;
  c.save();
  c.globalAlpha *= alpha;
  c.translate(x, y);
  const glow = c.createRadialGradient(0, 0, 0, 0, 0, r * 0.9);
  glow.addColorStop(0, rgba('#ffffff', 0.9));
  glow.addColorStop(1, rgba('#ffffff', 0));
  c.fillStyle = glow;
  c.fillRect(-r, -r, r * 2, r * 2);
  c.fillStyle = color;
  c.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU - Math.PI / 2;
    const rr = i % 2 ? r * 0.16 : r;
    c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  c.closePath();
  c.fill();
  c.restore();
}

/* ------------------------------------------------------------ 1. Aqua Gel */
// Chunky glossy gel letters: white rim, coloured body, gloss band, glint and a reflection.
const gel = {
  id: 'gel',
  name: 'Aqua Gel',
  font: (s) => `italic 900 ${s}px ${FONT}`,
  tracking: -0.02,
  scale: 1,
  draw(g, P) {
    const { R, size } = P;
    g.font = P.font;
    g.lineJoin = 'round';
    g.textBaseline = 'alphabetic';
    const body = (c) => (P.rainbow ? rainbowGradient(c, P) : verticalGradient(c, P, [[0, R.top], [0.45, R.mid], [1, R.bottom]]));

    // Mirror reflection, fading out below the baseline.
    if (!P.small && P.type !== 'miss' && P.type !== 'lazy') {
      layer(g, (o) => {
        o.font = P.font;
        o.translate(0, 2 * P.y + size * 0.1);
        o.scale(1, -1);
        o.fillStyle = body(o);
        fillAll(o, P);
        o.setTransform(g.getTransform());
        o.globalCompositeOperation = 'destination-in';
        const fade = o.createLinearGradient(0, P.y, 0, P.y + size * 0.5);
        fade.addColorStop(0, 'rgba(0,0,0,0.35)');
        fade.addColorStop(1, 'rgba(0,0,0,0)');
        o.fillStyle = fade;
        o.fillRect(P.x - 40, P.y, P.width + 80, size * 0.6);
      });
    }
    g.save();
    g.shadowColor = 'rgba(0, 30, 80, 0.45)';
    g.shadowBlur = 16;
    g.shadowOffsetY = 6;
    g.lineWidth = size * 0.2;
    g.strokeStyle = 'rgba(255,255,255,0.96)';
    strokeAll(g, P);
    g.restore();
    g.lineWidth = size * 0.1;
    g.strokeStyle = R.outline;
    strokeAll(g, P);
    layer(g, (o) => {
      o.font = P.font;
      o.fillStyle = body(o);
      fillAll(o, P);
      o.globalCompositeOperation = 'source-atop';
      const top = P.y - size * 0.78;
      const mid = P.y - size * 0.36;
      const gloss = o.createLinearGradient(0, top, 0, mid);
      gloss.addColorStop(0, 'rgba(255,255,255,0.92)');
      gloss.addColorStop(1, 'rgba(255,255,255,0.1)');
      o.fillStyle = gloss;
      o.fillRect(P.x - 40, top - 10, P.width + 80, mid - top + 10);
      const bounce = o.createLinearGradient(0, P.y - size * 0.18, 0, P.y + 4);
      bounce.addColorStop(0, 'rgba(255,255,255,0)');
      bounce.addColorStop(1, 'rgba(255,255,255,0.35)');
      o.fillStyle = bounce;
      o.fillRect(P.x - 40, P.y - size * 0.18, P.width + 80, size * 0.25);
      glint(o, P);
    });
  },
};

/* ---------------------------------------------------------- 2. Chrome Aero */
// Vista chrome: bevelled letters with a horizon band, a coloured aura and a lens sparkle.
const chrome = {
  id: 'chrome',
  name: 'Chrome Aero',
  font: (s) => `italic 900 ${s}px ${FONT}`,
  tracking: 0.0,
  scale: 0.96,
  draw(g, P) {
    const { R, size } = P;
    g.font = P.font;
    g.lineJoin = 'round';
    g.textBaseline = 'alphabetic';
    g.save();
    g.shadowColor = P.rainbow ? '#ffd23f' : R.mid;
    g.shadowBlur = 26;
    g.fillStyle = rgba(P.rainbow ? '#ffd23f' : R.mid, 0.9);
    fillAll(g, P);
    g.restore();
    g.save();
    g.lineWidth = size * 0.11;
    g.strokeStyle = '#08213b';
    eachLetter(g, P, (ch, x, y) => g.strokeText(ch, x, y + size * 0.035));
    g.lineWidth = size * 0.07;
    g.strokeStyle = '#ffffff';
    eachLetter(g, P, (ch, x, y) => g.strokeText(ch, x, y - size * 0.02));
    g.restore();
    layer(g, (o) => {
      o.font = P.font;
      const band = P.rainbow ? '#8a5a00' : shade(R.bottom, 0.45);
      // Sky above the horizon band, the rating colour below it (the classic chrome read).
      o.fillStyle = verticalGradient(o, P, [[0, '#ffffff'], [0.4, P.rainbow ? '#fff2b0' : R.top], [0.5, band], [0.56, P.rainbow ? '#ff9d1c' : R.bottom], [0.85, P.rainbow ? '#ffd23f' : R.mid], [1, P.rainbow ? '#fff2b0' : R.top]]);
      fillAll(o, P);
      o.globalCompositeOperation = 'source-atop';
      if (P.rainbow) {
        o.globalAlpha = 0.35;
        o.fillStyle = rainbowGradient(o, P, RAINBOW, 0.7);
        o.fillRect(P.x - 40, P.y - size, P.width + 80, size * 1.2);
        o.globalAlpha = 1;
      }
      glint(o, P, 0.95);
    });
    g.lineWidth = 2;
    g.strokeStyle = P.rainbow ? '#7a4300' : R.outline;
    strokeAll(g, P);
    if (!P.small) {
      const pulse = 0.6 + 0.4 * Math.sin(P.now * 5);
      const burst = P.glint >= 0 && P.glint <= 1 ? Math.sin(P.glint * Math.PI) : 0;
      sparkle(g, P.x + P.width - size * 0.15, P.y - size * 0.7, size * (0.32 + 0.4 * burst) * pulse, '#ffffff', P.enter);
      sparkle(g, P.x + size * 0.12, P.y - size * 0.05, size * 0.18 * (1 - pulse * 0.5), '#ffffff', P.enter * 0.8);
    }
  },
};

/* --------------------------------------------------------------- 3. Liquid */
// Translucent water letters that drop in one by one, wobble and shimmer with caustics.
const liquid = {
  id: 'liquid',
  name: 'Liquid',
  font: (s) => `italic 900 ${s}px ${FONT}`,
  tracking: 0.01,
  scale: 1,
  letters(letters, P) {
    if (P.small) return;
    letters.forEach((l, i) => {
      const a = P.age - i * 0.045;
      const k = clamp01(a / 0.38);
      // Fall in and splash: a bounce on landing with squash and stretch.
      const bounce = k < 1 ? Math.abs(Math.cos(k * Math.PI * 1.5)) * (1 - k) ** 2 : 0;
      l.dy -= 90 * bounce;
      l.sy *= 1 - 0.28 * Math.sin(Math.min(1, k * 1.2) * Math.PI) * (1 - k);
      l.sx *= 1 + 0.18 * Math.sin(Math.min(1, k * 1.2) * Math.PI) * (1 - k);
      l.alpha *= a > 0 ? 1 : 0;
      l.dy += Math.sin(P.now * 4 + i * 0.7) * 3 * clamp01(P.age);
    });
  },
  draw(g, P) {
    const { R, size } = P;
    g.font = P.font;
    g.lineJoin = 'round';
    g.textBaseline = 'alphabetic';
    g.save();
    g.shadowColor = rgba(R.bottom, 0.6);
    g.shadowBlur = 20;
    g.shadowOffsetY = 6;
    g.lineWidth = size * 0.09;
    g.strokeStyle = rgba(R.outline, 0.85);
    strokeAll(g, P);
    g.restore();
    layer(g, (o) => {
      o.font = P.font;
      o.fillStyle = P.rainbow
        ? rainbowGradient(o, P, ['#7ff6ff', '#9dffcf', '#fff3a0', '#ffb0e8', '#b9a2ff'], 0.35)
        : verticalGradient(o, P, [[0, rgba(R.top, 1)], [0.5, rgba(R.mid, 0.92)], [1, rgba(R.bottom, 1)]]);
      fillAll(o, P);
      o.globalCompositeOperation = 'source-atop';
      // Caustic ripples drifting through the water.
      o.lineWidth = size * 0.035;
      o.strokeStyle = 'rgba(255,255,255,0.32)';
      for (let k = 0; k < 7; k++) {
        o.beginPath();
        const yy = P.y - size * 0.85 + k * size * 0.16;
        for (let x = P.x - 20; x <= P.x + P.width + 20; x += 12) {
          o.lineTo(x, yy + Math.sin(x * 0.04 + P.now * 3 + k * 1.7) * size * 0.05);
        }
        o.stroke();
      }
      const gloss = o.createLinearGradient(0, P.y - size * 0.8, 0, P.y - size * 0.4);
      gloss.addColorStop(0, 'rgba(255,255,255,0.45)');
      gloss.addColorStop(1, 'rgba(255,255,255,0)');
      o.fillStyle = gloss;
      o.fillRect(P.x - 40, P.y - size * 0.9, P.width + 80, size * 0.5);
    });
    g.lineWidth = size * 0.02;
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    strokeAll(g, P);
    // A bright specular dot on each letter.
    g.fillStyle = 'rgba(255,255,255,0.9)';
    eachLetter(g, P, (ch, x, y, l) => {
      g.beginPath();
      g.ellipse(x + l.w * 0.32, y - size * 0.58, size * 0.05, size * 0.028, -0.5, 0, TAU);
      g.fill();
    });
  },
};

/* ------------------------------------------------------------- 4. Sky Glow */
// Airy white letters glowing in the rating colour, sliding in on an anamorphic light streak.
const skyglow = {
  id: 'skyglow',
  name: 'Sky Glow',
  font: (s) => `800 ${s}px ${FONT}`,
  tracking: 0.09,
  scale: 0.9,
  transform(g, P) {
    if (!P.small) g.translate(-150 * (1 - easeOut(P.enter)), 0);
  },
  draw(g, P) {
    const { R, size } = P;
    const tint = P.rainbow ? '#ffd23f' : R.mid;
    g.font = P.font;
    g.textBaseline = 'alphabetic';
    const cx = P.x + P.width / 2;
    const cy = P.y - size * 0.36;
    if (!P.small) {
      // Light streak behind the word.
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.translate(cx, cy);
      g.scale(1, 0.14);
      const r = P.width * 0.75;
      const halo = g.createRadialGradient(0, 0, 0, 0, 0, r);
      halo.addColorStop(0, rgba(tint, 0.75));
      halo.addColorStop(1, rgba(tint, 0));
      g.fillStyle = halo;
      g.fillRect(-r, -r, r * 2, r * 2);
      g.restore();
      g.save();
      g.globalCompositeOperation = 'lighter';
      const line = g.createLinearGradient(cx - P.width * 0.8, 0, cx + P.width * 0.8, 0);
      line.addColorStop(0, 'rgba(255,255,255,0)');
      line.addColorStop(0.5, 'rgba(255,255,255,0.95)');
      line.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = line;
      g.fillRect(cx - P.width * 0.8, cy - 2, P.width * 1.6, 4);
      g.restore();
      // Afterimages while it slides in.
      const trail = 1 - easeOut(P.enter);
      for (let j = 1; j <= 3 && trail > 0.02; j++) {
        g.save();
        g.translate(-j * 46 * trail, 0);
        g.globalAlpha *= (0.32 / j) * trail;
        g.fillStyle = tint;
        fillAll(g, P);
        g.restore();
      }
    }
    g.save();
    // A soft, darker drop shadow so white-on-glow still reads over a bright sky.
    const deep = P.rainbow ? '#b86a00' : shade(R.bottom, 0.7);
    g.shadowColor = rgba(deep, 0.85);
    g.shadowBlur = 8;
    g.shadowOffsetY = 4;
    g.fillStyle = rgba(deep, 0.9);
    fillAll(g, P);
    g.shadowOffsetY = 0;
    g.shadowColor = tint;
    g.shadowBlur = 30;
    g.fillStyle = rgba(tint, 0.9);
    fillAll(g, P);
    g.shadowBlur = 10;
    g.shadowColor = rgba('#ffffff', 0.9);
    g.fillStyle = P.rainbow ? rainbowGradient(g, P, ['#fff6c8', '#ffffff', '#d8fbff', '#ffe0f6'], 0.4) : verticalGradient(g, P, [[0, '#ffffff'], [0.65, '#ffffff'], [1, R.top]]);
    fillAll(g, P);
    g.restore();
    if (!P.small) {
      P.letters.forEach((l, i) => {
        if (i % 3 !== 1 || l.alpha < 0.5) return;
        const tw = 0.5 + 0.5 * Math.sin(P.now * 6 + i * 2.1);
        sparkle(g, P.x + l.x + l.w * 0.8 + l.dx, P.y + l.dy - size * 0.82, size * 0.17 * tw, '#ffffff', P.enter);
      });
    }
  },
};

/* ------------------------------------------------------------ 5. Holo Glass */
// Smoky glass letters with an iridescent rim, swinging in like a glass panel turning.
const holo = {
  id: 'holo',
  name: 'Holo Glass',
  font: (s) => `italic 900 ${s}px ${FONT}`,
  tracking: 0.02,
  scale: 0.98,
  transform(g, P, cx, cy) {
    if (P.small) return;
    const k = easeOut(P.enter);
    g.translate(cx, cy);
    g.transform(0.65 + 0.35 * k, 0, -0.5 * (1 - k), 1, 0, 0);
    g.translate(-cx, -cy);
  },
  draw(g, P) {
    const { R, size } = P;
    g.font = P.font;
    g.lineJoin = 'round';
    g.textBaseline = 'alphabetic';
    const irid = P.rainbow
      ? rainbowGradient(g, P, ['#7ff6ff', '#ff9be8', '#c6ff7a', '#b9a2ff', '#ffe27a'], 0.6)
      : rainbowGradient(g, P, [R.top, '#ffffff', R.mid, '#e8fbff', R.top], 0.4);
    g.save();
    g.shadowColor = P.rainbow ? '#ff9be8' : R.mid;
    g.shadowBlur = 18;
    g.lineWidth = size * 0.1;
    g.strokeStyle = rgba(P.rainbow ? '#b9a2ff' : R.mid, 0.55);
    strokeAll(g, P);
    g.restore();
    layer(g, (o) => {
      o.font = P.font;
      o.fillStyle = verticalGradient(o, P, [[0, rgba(shade(R.bottom, 0.6), 0.55)], [1, rgba(shade(R.bottom, 0.35), 0.8)]]);
      fillAll(o, P);
      o.globalCompositeOperation = 'source-atop';
      const sheen = o.createLinearGradient(0, P.y - size * 0.8, 0, P.y - size * 0.3);
      sheen.addColorStop(0, 'rgba(255,255,255,0.55)');
      sheen.addColorStop(1, 'rgba(255,255,255,0.04)');
      o.fillStyle = sheen;
      o.fillRect(P.x - 40, P.y - size, P.width + 80, size * 0.7);
      // Slow diagonal light stripe drifting across the glass.
      const sx = P.x + (((P.now * 0.35) % 1) * (P.width + 200)) - 100;
      o.fillStyle = 'rgba(255,255,255,0.22)';
      o.beginPath();
      o.moveTo(sx, P.y - size);
      o.lineTo(sx + 26, P.y - size);
      o.lineTo(sx - 14, P.y + 10);
      o.lineTo(sx - 40, P.y + 10);
      o.closePath();
      o.fill();
      glint(o, P, 0.7);
    });
    g.lineWidth = size * 0.05;
    g.strokeStyle = irid;
    strokeAll(g, P);
    g.lineWidth = 1.5;
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    strokeAll(g, P);
  },
};

export const TEXT_DESIGNS = [gel, chrome, liquid, skyglow, holo];
