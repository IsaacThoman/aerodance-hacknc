import '@fontsource/nunito/800.css';

/*
 * Five minimal Frutiger Aero looks for the move ratings. Each design gets a prepared
 * label `P` (letters already laid out and animated by textFeedback.js) and paints it:
 *
 *   P = { R, type, size, font, x, y (baseline), width, letters[], now, age,
 *         enter (0..1 entry progress), leave (0..1 exit progress),
 *         rainbow (Perfect), small (combo line) }
 *
 * Optional settings: lead(size) (room kept left of the word), comboGap (extra room above
 * the combo line). Optional hooks: letters(letters, P) for per-letter motion,
 * transform(g, P, cx, cy) for an extra whole-label transform.
 *
 * Each design keeps to one idea and flat colour; nothing glows. Over the bright sky the
 * words stay readable through a deep ink colour, a thin outline or a tight shadow.
 */

export const FONT = '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif';
export const ROUND = `"Nunito", ${FONT}`;
const TAU = Math.PI * 2;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeOut = (t) => 1 - (1 - t) ** 3;
const backOut = (t, s = 2.2) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;

/* ------------------------------------------------------------------ helpers */

let off = null;
/** Paint into a scratch canvas with the same transform, then composite it back. Lets a
 *  design use 'source-atop' tricks (water) that only land on the letters. */
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

// Soap-bubble iridescence for Perfect: soft for glass and bubbles, deeper for ink.
const IRIS = ['#ff9be8', '#ffe27a', '#9dffcf', '#7fe7ff', '#b9a2ff'];
const IRIS_DEEP = ['#e0489f', '#e08a00', '#18a86a', '#1a8fd6', '#7a52e0'];

/** Horizontal colour film over [x, x + w] that drifts with time (repeats so it loops). */
function iris(c, x, w, now, colors = IRIS, speed = 0.4) {
  w = Math.max(w, 1);
  const shift = ((now * speed) % 1) * w;
  const grad = c.createLinearGradient(x - w + shift, 0, x + w + shift, 0);
  const list = [...colors, ...colors, colors[0]];
  list.forEach((col, i) => grad.addColorStop(i / (list.length - 1), col));
  return grad;
}

/** Crisp four-point twinkle (no halo). */
export function sparkle(c, x, y, r, color = '#ffffff', alpha = 1) {
  if (r <= 0.5 || alpha <= 0.01) return;
  c.save();
  c.globalAlpha *= alpha;
  c.translate(x, y);
  c.fillStyle = color;
  c.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU - Math.PI / 2;
    const rr = i % 2 ? r * 0.18 : r;
    c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  c.closePath();
  c.fill();
  c.restore();
}

/* ------------------------------------------------------------- 1. Sky Glow */
// White letters held in a liquid glass capsule: lightly tinted body, a bright rim where the
// light catches it, thickness along the inside edge, a top highlight and light gathering
// at the bottom. It slides in and wobbles like a drop of water as it lands.

function glassCapsule(g, x, y, w, h, P) {
  const { R } = P;
  const r = h / 2;
  const top = P.rainbow ? '#ffd23f' : R.mid;
  const bottom = P.rainbow ? '#ff9d1c' : R.bottom;
  const deep = shade(bottom, 0.45);
  const path = () => {
    g.beginPath();
    g.roundRect(x, y, w, h, r);
  };
  // Body, lifted off the sky by a soft shadow (shadow units are buffer pixels).
  g.save();
  g.shadowColor = rgba(deep, 0.3);
  g.shadowBlur = 6;
  g.shadowOffsetY = 3;
  path();
  // Warm colours over blue sky go muddy when thin, so gold and red glass is a little denser.
  const k = P.rainbow || P.type === 'miss' || P.type === 'broken' ? 1.5 : 1;
  const body = g.createLinearGradient(0, y, 0, y + h);
  body.addColorStop(0, rgba(top, 0.22 * k));
  body.addColorStop(0.6, rgba(bottom, 0.38 * k));
  body.addColorStop(1, rgba(bottom, 0.55 * k));
  g.fillStyle = body;
  g.fill();
  g.restore();
  // Inside the glass (clipped, so only the inner half of each stroke shows).
  g.save();
  path();
  g.clip();
  g.lineWidth = h * 0.24;
  g.strokeStyle = rgba(deep, 0.2);
  g.stroke();
  g.lineWidth = h * 0.08;
  g.strokeStyle = 'rgba(255,255,255,0.32)';
  g.stroke();
  const spec = g.createLinearGradient(0, y + h * 0.06, 0, y + h * 0.42);
  spec.addColorStop(0, 'rgba(255,255,255,0.62)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = spec;
  g.beginPath();
  g.roundRect(x + r * 0.55, y + h * 0.06, Math.max(0, w - r * 1.1), h * 0.36, h * 0.18);
  g.fill();
  const caustic = g.createLinearGradient(0, y + h, 0, y + h * 0.6);
  caustic.addColorStop(0, 'rgba(255,255,255,0.4)');
  caustic.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = caustic;
  g.fillRect(x + r * 0.6, y + h * 0.6, Math.max(0, w - r * 1.2), h * 0.4);
  g.restore();
  // Rim: bright along the top, faint at the sides, picking up again underneath.
  path();
  if (P.rainbow) g.strokeStyle = iris(g, x, w, P.now, IRIS, 0.5);
  else {
    const rim = g.createLinearGradient(0, y, 0, y + h);
    rim.addColorStop(0, 'rgba(255,255,255,0.95)');
    rim.addColorStop(0.5, 'rgba(255,255,255,0.25)');
    rim.addColorStop(1, 'rgba(255,255,255,0.75)');
    g.strokeStyle = rim;
  }
  g.lineWidth = Math.max(3, h * 0.04);
  g.stroke();
  // Specular glint on the upper-left shoulder.
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath();
  g.ellipse(x + r * 0.62, y + h * 0.24, h * 0.09, h * 0.05, -0.7, 0, TAU);
  g.fill();
}

const PAD = 0.55; // capsule padding either side of the word, in font sizes

const skyglow = {
  id: 'skyglow',
  name: 'Sky Glow',
  font: (s) => `800 ${s}px ${FONT}`,
  tracking: 0.09,
  scale: 0.8,
  lead: (s) => s * PAD,
  comboGap: 10,
  transform(g, P, cx, cy) {
    if (P.small) return;
    g.translate(-110 * (1 - easeOut(P.enter)), 0);
    // A liquid wobble as it lands: squash and stretch that settles quickly.
    const wob = 0.07 * Math.sin(P.age * 24) * Math.exp(-P.age * 6);
    g.translate(cx, cy);
    g.scale(1 + wob, 1 - wob);
    g.translate(-cx, -cy);
  },
  draw(g, P) {
    const { R, size } = P;
    const h = size * 1.32;
    const x = P.x - size * PAD;
    const w = P.width + size * PAD * 2;
    const y = P.y - size * 0.365 - h / 2;
    g.save();
    if (P.type === 'miss' && P.leave > 0) {
      // The letters spill out and the empty capsule fades.
      g.globalAlpha *= 1 - P.leave;
    }
    glassCapsule(g, x, y, w, h, P);
    g.restore();
    g.font = P.font;
    g.textBaseline = 'alphabetic';
    g.save();
    g.shadowColor = rgba(shade(P.rainbow ? '#ff9d1c' : R.bottom, 0.4), 0.8);
    g.shadowBlur = 1;
    g.shadowOffsetY = 2;
    g.fillStyle = '#ffffff';
    fillAll(g, P);
    g.restore();
  },
};

/* ------------------------------------------------------------ 2. Aqua Line */
// Just the word: evenly spaced capitals in flat deep ink of the rating colour.
const aqualine = {
  id: 'aqualine',
  name: 'Aqua Line',
  font: (s) => `700 ${s}px ${FONT}`,
  tracking: 0.05,
  scale: 0.92,
  draw(g, P) {
    g.font = P.font;
    g.textBaseline = 'alphabetic';
    g.fillStyle = P.rainbow ? iris(g, P.x, P.width, P.now, IRIS_DEEP, 0.3) : shade(P.R.bottom, 0.62);
    fillAll(g, P);
  },
};

/* ------------------------------------------------------------ 3. Waterline */
// Pale glass letters with a thin outline, filled with flat water. The level is the grade:
// Perfect brims, Great is nearly full, a Miss barely wets the bottom and drains.
const LEVEL = { perfect: 1.08, great: 0.8, good: 0.62, ok: 0.45, miss: 0.22, combo: 1.08, broken: 0.12 };
const waterline = {
  id: 'waterline',
  name: 'Waterline',
  font: (s) => `900 ${s}px ${FONT}`,
  tracking: 0.04,
  scale: 0.94,
  draw(g, P) {
    const { R, size } = P;
    const cap = size * 0.74;
    let level = LEVEL[P.type] ?? 1;
    if (!P.small) level *= easeOut(clamp01((P.age - 0.04) / 0.6));
    if (P.type === 'miss') level *= 1 - P.leave;
    const amp = P.small ? 0 : size * 0.02;
    g.font = P.font;
    g.textBaseline = 'alphabetic';
    g.lineJoin = 'round';
    // Outline first, at double width, then opaque glass and water on top: only the outer
    // half shows, which also hides the overlapping contours inside Inter's glyphs.
    g.lineWidth = Math.max(5, size * 0.056);
    g.strokeStyle = R.outline;
    strokeAll(g, P);
    layer(g, (o) => {
      o.font = P.font;
      o.fillStyle = '#f2fbff';
      fillAll(o, P);
      o.globalCompositeOperation = 'source-atop';
      o.fillStyle = R.mid;
      // Drawn per letter, so the water travels with each letter as it moves.
      eachLetter(o, P, (ch, x, y, l) => {
        o.beginPath();
        for (let xx = x - 4; xx <= x + l.w + 6; xx += 6) {
          o.lineTo(xx, -cap * level + Math.sin((l.x + xx - x) * 0.06 + P.now * 3) * amp);
        }
        o.lineTo(x + l.w + 6, size * 0.2);
        o.lineTo(x - 4, size * 0.2);
        o.closePath();
        o.fill();
      });
    });
  },
};

/* --------------------------------------------------------------- 4. Mirror */
// Flat colour letters that rise in one by one over a faint reflection, like a word set on
// a glossy floor.
const mirror = {
  id: 'mirror',
  name: 'Mirror',
  font: (s) => `700 ${s}px ${FONT}`,
  tracking: 0.03,
  scale: 0.92,
  letters(letters, P) {
    if (P.small) return;
    letters.forEach((l, i) => {
      const k = easeOut(clamp01((P.age - i * 0.035) / 0.3));
      l.dy += 26 * (1 - k);
      l.alpha *= k;
    });
  },
  draw(g, P) {
    const { R, size } = P;
    const face = (c) => (P.rainbow ? iris(c, P.x, P.width, P.now, IRIS_DEEP, 0.3) : R.bottom);
    g.font = P.font;
    g.textBaseline = 'alphabetic';
    if (!P.small && P.type !== 'miss') {
      const fy = P.y + size * 0.06;
      layer(g, (o) => {
        o.font = P.font;
        o.translate(0, 2 * fy);
        o.scale(1, -1);
        o.fillStyle = face(o);
        fillAll(o, P);
        o.setTransform(g.getTransform());
        o.globalCompositeOperation = 'destination-in';
        const fade = o.createLinearGradient(0, fy, 0, fy + size * 0.45);
        fade.addColorStop(0, 'rgba(0,0,0,0.36)');
        fade.addColorStop(1, 'rgba(0,0,0,0)');
        o.fillStyle = fade;
        o.fillRect(P.x - 40, fy, P.width + 80, size * 0.5);
      });
    }
    g.fillStyle = face(g);
    fillAll(g, P);
  },
};

/* --------------------------------------------------------------- 5. Bubble */
// One glossy bubble in the rating colour beside rounded white letters with a flat coloured
// edge. A Miss pops the bubble.
function orb(g, x, y, r, P) {
  g.save();
  g.translate(x, y);
  g.beginPath();
  g.arc(0, 0, r, 0, TAU);
  if (P.rainbow && g.createConicGradient) {
    const film = g.createConicGradient(P.now * 1.5, 0, 0);
    [...IRIS, IRIS[0]].forEach((col, i) => film.addColorStop(i / IRIS.length, col));
    g.fillStyle = film;
  } else g.fillStyle = P.R.mid;
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.beginPath();
  g.ellipse(-r * 0.12, -r * 0.48, r * 0.5, r * 0.26, -0.25, 0, TAU);
  g.fill();
  g.restore();
}

const bubble = {
  id: 'bubble',
  name: 'Bubble',
  font: (s) => `800 ${s}px ${ROUND}`,
  tracking: 0.01,
  scale: 0.94,
  lead: (s) => s * 0.74,
  draw(g, P) {
    const { R, size } = P;
    let r = size * 0.28;
    const ox = P.x - size * 0.74 + r;
    const oy = P.y - size * 0.36;
    let alpha = 1;
    if (!P.small) r *= backOut(clamp01(P.age / 0.26), 2.6);
    if (P.type === 'miss' && P.leave > 0) {
      // Pop: a thin ring spreads out where the bubble was.
      g.save();
      g.globalAlpha *= 1 - P.leave;
      g.lineWidth = 3;
      g.strokeStyle = R.mid;
      g.beginPath();
      g.arc(ox, oy, r * (1 + P.leave * 1.4), 0, TAU);
      g.stroke();
      g.restore();
      alpha = 1 - clamp01(P.leave * 4);
    }
    if (r > 0.5 && alpha > 0.01) {
      g.save();
      g.globalAlpha *= alpha;
      orb(g, ox, oy, r, P);
      g.restore();
    }

    g.font = P.font;
    g.textBaseline = 'alphabetic';
    g.fillStyle = P.rainbow ? '#d98a0b' : shade(R.bottom, 0.85);
    eachLetter(g, P, (ch, x, y) => g.fillText(ch, x, y + size * 0.06));
    g.fillStyle = '#ffffff';
    fillAll(g, P);
  },
};

export const TEXT_DESIGNS = [skyglow, aqualine, waterline, mirror, bubble];
