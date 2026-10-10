/*
 * Move-rating popups for the top-left corner, drawn with the 2D canvas API in 16:9 design
 * units (1600x900) onto a canvas the size of the 640x480 render buffer, the same way the
 * main app's title menu is drawn. Everything here is plain functions so it can move into
 * the game later unchanged.
 *
 *   const fb = createFeedback();
 *   fb.trigger('perfect', now);   // on each judged move
 *   fb.draw(ctx, now);            // every frame, after setting the design-unit transform
 */

export const W = 1600;
export const H = 900;
const FONT = '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif';
const TAU = Math.PI * 2;

// Where the popup sits: top-left corner, clear of the screen edge.
const ANCHOR = { x: 56, y: 40 };
const BADGE_H = 110;

export const RATINGS = {
  perfect: {
    label: 'PERFECT', icon: 'star', size: 66, hold: 1.15,
    top: '#fffbe0', mid: '#ffd23f', bottom: '#ff9d1c', disc: ['#ffcc33', '#e07800'], outline: '#9a4d00',
    particles: 'stars', count: 24, combo: true,
  },
  great: {
    label: 'GREAT', icon: 'check2', size: 66, hold: 1.0,
    top: '#eafff6', mid: '#5ef0b4', bottom: '#12b886', disc: ['#3ddc97', '#0b8a5f'], outline: '#06603f',
    particles: 'bubbles', count: 14, combo: true,
  },
  good: {
    label: 'GOOD', icon: 'check', size: 62, hold: 0.95,
    top: '#e8f8ff', mid: '#62cbff', bottom: '#1b7fe0', disc: ['#4fb6f2', '#0d5fae'], outline: '#0a3f78',
    particles: 'bubbles', count: 8, combo: true,
  },
  ok: {
    label: 'OK', icon: 'ring', size: 56, hold: 0.85,
    top: '#f3f0ff', mid: '#b9aaff', bottom: '#7a68dc', disc: ['#a291f2', '#5a48b8'], outline: '#3d2f8a',
    particles: 'bubbles', count: 4, combo: true,
  },
  miss: {
    label: 'MISS', icon: 'x', size: 66, hold: 0.8,
    top: '#ffe6e6', mid: '#ff7070', bottom: '#d12b2b', disc: ['#ff5c5c', '#a51717'], outline: '#7a0d0d',
    particles: 'drops', count: 12, combo: false,
  },
  lazy: {
    label: 'NOT EVEN TRYING', icon: 'sleepy', size: 46, hold: 1.25,
    top: '#f1f4f7', mid: '#b4bec8', bottom: '#717d89', disc: ['#a7b2bd', '#5b6672'], outline: '#3a434c',
    particles: 'zzz', count: 0, combo: false,
  },
};

export const ORDER = ['perfect', 'great', 'good', 'ok', 'miss', 'lazy'];
export const NAMES = { perfect: 'Perfect', great: 'Great', good: 'Good', ok: 'OK', miss: 'Miss', lazy: 'Not even trying' };

/* --------------------------------------------------------------- drawing kit */

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeOut = (t) => 1 - (1 - t) ** 3;
// Overshooting ease for the pop-in.
const backOut = (t, s = 2.2) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;

export function pill(g, x, y, w, h) {
  const r = h / 2;
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  g.lineTo(x + r, y + h);
  g.arc(x + r, y + r, r, Math.PI / 2, (3 * Math.PI) / 2);
  g.closePath();
}

export function starPath(g, cx, cy, r, inner = 0.45, points = 5, rot = -Math.PI / 2) {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rr = i % 2 ? r * inner : r;
    const a = rot + (i / (points * 2)) * TAU;
    g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.closePath();
}

function icon(g, kind, cx, cy, r, t) {
  g.save();
  g.strokeStyle = '#ffffff';
  g.fillStyle = '#ffffff';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = 8;
  const s = r * 0.5;
  if (kind === 'star') {
    starPath(g, cx, cy, s * 1.15, 0.45, 5, -Math.PI / 2 + Math.sin(t * 3) * 0.08);
    g.fill();
  } else if (kind === 'check' || kind === 'check2') {
    const tick = (ox) => {
      g.beginPath();
      g.moveTo(cx - s * 0.75 + ox, cy + s * 0.05);
      g.lineTo(cx - s * 0.2 + ox, cy + s * 0.55);
      g.lineTo(cx + s * 0.8 + ox, cy - s * 0.55);
      g.stroke();
    };
    if (kind === 'check2') { g.lineWidth = 7; tick(-s * 0.3); tick(s * 0.3); } else tick(0);
  } else if (kind === 'ring') {
    g.beginPath();
    g.arc(cx, cy, s * 0.6, 0, TAU);
    g.stroke();
  } else if (kind === 'x') {
    g.beginPath();
    g.moveTo(cx - s * 0.6, cy - s * 0.6);
    g.lineTo(cx + s * 0.6, cy + s * 0.6);
    g.moveTo(cx + s * 0.6, cy - s * 0.6);
    g.lineTo(cx - s * 0.6, cy + s * 0.6);
    g.stroke();
  } else if (kind === 'sleepy') {
    // Closed eyes and a flat little mouth.
    g.lineWidth = 6;
    for (const ox of [-0.42, 0.42]) {
      g.beginPath();
      g.arc(cx + s * ox, cy - s * 0.12, s * 0.26, 0.15 * Math.PI, 0.85 * Math.PI);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(cx - s * 0.22, cy + s * 0.5);
    g.lineTo(cx + s * 0.22, cy + s * 0.5);
    g.stroke();
  }
  g.restore();
}

/**
 * One glossy gel badge: drop shadow, gradient body, top sheen, white rim, icon disc on the
 * left and the label. Returns nothing; draws around (x, y) top-left.
 */
function badge(g, R, x, y, w, h, now, age, extra) {
  const r = h / 2;
  // Body.
  g.save();
  g.shadowColor = 'rgba(0, 30, 70, 0.45)';
  g.shadowBlur = 22;
  g.shadowOffsetY = 8;
  pill(g, x, y, w, h);
  const body = g.createLinearGradient(0, y, 0, y + h);
  body.addColorStop(0, R.top);
  body.addColorStop(0.5, R.mid);
  body.addColorStop(1, R.bottom);
  g.fillStyle = body;
  g.fill();
  g.restore();

  // Sheen + glint (clipped to the pill).
  g.save();
  pill(g, x, y, w, h);
  g.clip();
  const sheen = g.createLinearGradient(0, y, 0, y + h * 0.5);
  sheen.addColorStop(0, 'rgba(255,255,255,0.85)');
  sheen.addColorStop(1, 'rgba(255,255,255,0.08)');
  g.fillStyle = sheen;
  pill(g, x + 12, y + 5, w - 24, h * 0.46);
  g.fill();
  if (extra.glint >= 0 && extra.glint <= 1) {
    const gx = x - 120 + (w + 240) * easeOut(extra.glint);
    const band = g.createLinearGradient(gx - 60, 0, gx + 60, 0);
    band.addColorStop(0, 'rgba(255,255,255,0)');
    band.addColorStop(0.5, 'rgba(255,255,255,0.75)');
    band.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = band;
    g.beginPath();
    g.moveTo(gx - 40, y - 10);
    g.lineTo(gx + 40, y - 10);
    g.lineTo(gx - 10, y + h + 10);
    g.lineTo(gx - 90, y + h + 10);
    g.closePath();
    g.fill();
  }
  if (extra.crack > 0) {
    // Hairline cracks spreading from the hit point.
    g.strokeStyle = `rgba(90, 0, 0, ${0.65 * extra.crack})`;
    g.lineWidth = 3;
    const cx = x + w * 0.62;
    const cy = y + h * 0.45;
    const rays = [[-0.9, 0.7], [-0.25, 1], [0.35, 0.85], [1.1, 0.6], [2.4, 0.9], [3.6, 0.7], [4.6, 1]];
    for (const [a, len] of rays) {
      g.beginPath();
      g.moveTo(cx, cy);
      let px = cx;
      let py = cy;
      for (let k = 1; k <= 3; k++) {
        px += Math.cos(a + (k % 2 ? 0.35 : -0.3)) * 28 * len * extra.crack;
        py += Math.sin(a + (k % 2 ? 0.35 : -0.3)) * 28 * len * extra.crack;
        g.lineTo(px, py);
      }
      g.stroke();
    }
  }
  g.restore();

  // Rim.
  pill(g, x, y, w, h);
  g.lineWidth = 4;
  g.strokeStyle = 'rgba(255,255,255,0.92)';
  g.stroke();

  // Icon disc.
  const dcx = x + r;
  const dcy = y + r;
  const dr = r - 11;
  g.save();
  g.shadowColor = 'rgba(0, 30, 60, 0.4)';
  g.shadowBlur = 10;
  g.shadowOffsetY = 3;
  g.beginPath();
  g.arc(dcx, dcy, dr, 0, TAU);
  const disc = g.createLinearGradient(0, dcy - dr, 0, dcy + dr);
  disc.addColorStop(0, R.disc[0]);
  disc.addColorStop(1, R.disc[1]);
  g.fillStyle = disc;
  g.fill();
  g.restore();
  g.beginPath();
  g.ellipse(dcx, dcy - dr * 0.45, dr * 0.72, dr * 0.4, 0, 0, TAU);
  g.fillStyle = 'rgba(255,255,255,0.28)';
  g.fill();
  icon(g, R.icon, dcx, dcy, dr, now);

  // Label: dark outline, then a white (or rainbow, for Perfect) fill.
  const tx = x + h + 6;
  const ty = y + h / 2 + 3;
  g.save();
  g.font = `italic 900 ${R.size}px ${FONT}`;
  g.textBaseline = 'middle';
  if ('letterSpacing' in g) g.letterSpacing = '-1px';
  g.lineJoin = 'round';
  g.lineWidth = 9;
  g.strokeStyle = R.outline;
  const letters = extra.sag > 0 ? [...R.label] : null;
  const drawText = (fn) => {
    if (!letters) { fn(R.label, tx, ty); return; }
    // Drooping letters for "not even trying": each sags a little more than the last.
    let cx = tx;
    letters.forEach((ch, i) => {
      g.save();
      const droop = Math.sin(i * 0.9 + now * 2) * 2 + i * extra.sag * 1.1;
      g.translate(cx, ty + droop);
      g.rotate(extra.sag * 0.02 * Math.sin(i + now));
      fn(ch, 0, 0);
      g.restore();
      cx += g.measureText(ch).width - 1;
    });
  };
  drawText((s, px, py) => g.strokeText(s, px, py));
  if (extra.rainbow) {
    const tw = g.measureText(R.label).width;
    const shift = ((now * 0.5) % 1) * tw;
    const grad = g.createLinearGradient(tx - tw + shift, 0, tx + tw + shift, 0);
    const cols = ['#ff6ad5', '#ffd23f', '#a8ff5a', '#56f4ff', '#b48cff', '#ff6ad5', '#ffd23f', '#a8ff5a', '#56f4ff'];
    cols.forEach((c, i) => grad.addColorStop(i / (cols.length - 1), c));
    g.fillStyle = grad;
  } else g.fillStyle = '#ffffff';
  drawText((s, px, py) => g.fillText(s, px, py));
  g.restore();
}

/* ----------------------------------------------------------------- particles */

export function spawnParticles(type, cx, cy, w, h) {
  const R = RATINGS[type];
  const out = [];
  for (let i = 0; i < R.count; i++) {
    const a = Math.random() * TAU;
    if (R.particles === 'stars') {
      const sp = 260 + Math.random() * 380;
      out.push({ kind: 'star', x: cx + Math.cos(a) * w * 0.3, y: cy + Math.sin(a) * h * 0.3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7 - 60, r: 7 + Math.random() * 10, spin: (Math.random() - 0.5) * 8, life: 0.7 + Math.random() * 0.5, color: Math.random() < 0.3 ? '#ffffff' : Math.random() < 0.5 ? '#ffe066' : '#ffb347' });
    } else if (R.particles === 'bubbles') {
      out.push({ kind: 'bubble', x: cx + (Math.random() - 0.5) * w * 0.9, y: cy + (Math.random() - 0.2) * h * 0.6, vx: (Math.random() - 0.5) * 60, vy: -80 - Math.random() * 140, r: 5 + Math.random() * 12, life: 0.8 + Math.random() * 0.6, wob: Math.random() * TAU });
    } else if (R.particles === 'drops') {
      out.push({ kind: 'drop', x: cx + (Math.random() - 0.5) * w * 0.7, y: cy + h * 0.3, vx: (Math.random() - 0.5) * 160, vy: -60 - Math.random() * 120, r: 5 + Math.random() * 6, life: 0.9 + Math.random() * 0.4 });
    }
  }
  return out;
}

export function drawParticle(g, p, age) {
  const k = clamp01(age / p.life);
  const alpha = 1 - k * k;
  g.save();
  g.globalAlpha = alpha;
  if (p.kind === 'star') {
    starPath(g, p.x, p.y, p.r * (1 - k * 0.5), 0.42, 5, p.spin * age);
    g.fillStyle = p.color;
    g.shadowColor = 'rgba(255, 220, 120, 0.9)';
    g.shadowBlur = 10;
    g.fill();
  } else if (p.kind === 'bubble') {
    const x = p.x + Math.sin(age * 6 + p.wob) * 4;
    g.beginPath();
    g.arc(x, p.y, p.r, 0, TAU);
    g.fillStyle = 'rgba(200, 245, 255, 0.18)';
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    g.stroke();
    g.beginPath();
    g.ellipse(x - p.r * 0.35, p.y - p.r * 0.4, p.r * 0.3, p.r * 0.18, -0.6, 0, TAU);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fill();
  } else if (p.kind === 'drop') {
    g.translate(p.x, p.y);
    g.rotate(Math.atan2(p.vy, p.vx) - Math.PI / 2);
    g.beginPath();
    g.moveTo(0, -p.r * 1.6);
    g.quadraticCurveTo(p.r, 0, 0, p.r);
    g.quadraticCurveTo(-p.r, 0, 0, -p.r * 1.6);
    const d = g.createLinearGradient(0, -p.r, 0, p.r);
    d.addColorStop(0, '#ffb3b3');
    d.addColorStop(1, '#d12b2b');
    g.fillStyle = d;
    g.fill();
  }
  g.restore();
}

/* ------------------------------------------------------------------ feedback */

export function createFeedback() {
  let hold = false; // keep each rating up until the next one (for reviewing)
  const pops = [];
  const combo = { n: 0, bump: -10, broken: -10, lost: 0 };
  const measure = document.createElement('canvas').getContext('2d');

  function trigger(type, now) {
    const R = RATINGS[type];
    // A new rating hurries the previous one off.
    for (const p of pops) p.leaveAt = Math.min(p.leaveAt, now + 0.08);
    measure.font = `italic 900 ${R.size}px ${FONT}`;
    const w = BADGE_H + 10 + measure.measureText(R.label).width + 46;
    const pop = { type, born: now, leaveAt: hold ? Infinity : now + R.hold, w, particles: spawnParticles(type, ANCHOR.x + w / 2, ANCHOR.y + BADGE_H / 2, w, BADGE_H) };
    pops.push(pop);
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
    const OUT = p.type === 'miss' ? 0.55 : p.type === 'lazy' ? 0.6 : 0.25;
    if (out > OUT) return false;
    const h = BADGE_H;
    const cx = ANCHOR.x + p.w / 2;
    const cy = ANCHOR.y + h / 2;
    let scale = 1;
    let sx = 1;
    let sy = 1;
    let rot = 0;
    let dx = 0;
    let dy = 0;
    let alpha = 1;
    const extra = { glint: (age - 0.12) / 0.4, crack: 0, rainbow: false, sag: 0 };

    if (p.type === 'perfect') {
      // Slams in from big, with a burst of light behind it.
      const k = clamp01(age / 0.22);
      scale = 1.7 - 0.7 * backOut(k, 1.4);
      extra.rainbow = true;
    } else if (p.type === 'miss') {
      scale = backOut(clamp01(age / 0.18), 1.2) * 0.9 + 0.1;
      dx = Math.sin(age * 70) * 9 * Math.exp(-age * 7);
      extra.crack = clamp01((age - 0.08) / 0.15);
      extra.glint = -1;
    } else if (p.type === 'lazy') {
      // Shuffles in without any energy and slowly deflates.
      const k = easeOut(clamp01(age / 0.5));
      scale = 0.85 + 0.15 * k;
      rot = -0.05 * k;
      dy = 8 * k;
      sy = 1 - 0.08 * clamp01((age - 0.4) / 0.8);
      extra.sag = clamp01((age - 0.3) / 0.6);
      extra.glint = -1;
    } else {
      scale = 0.35 + 0.65 * backOut(clamp01(age / 0.24), p.type === 'ok' ? 1 : 2);
    }

    if (out > 0) {
      const k = out / OUT;
      if (p.type === 'miss') {
        dy += 260 * k * k;
        rot += 0.35 * k;
        alpha = 1 - k;
      } else if (p.type === 'lazy') {
        dy += 30 * k;
        sy *= 1 - 0.5 * k;
        alpha = 1 - k;
      } else {
        dy -= 26 * easeOut(k);
        scale *= 1 - 0.08 * k;
        alpha = 1 - k;
      }
    }

    g.save();
    g.globalAlpha = alpha;

    // Perfect: rotating sunburst and a shock ring behind the badge.
    if (p.type === 'perfect') {
      const show = clamp01(age / 0.15) * (1 - clamp01(out / OUT));
      g.save();
      g.translate(cx, cy);
      g.rotate(now * 0.8);
      g.globalAlpha = alpha * 0.55 * show;
      for (let i = 0; i < 14; i++) {
        g.rotate(TAU / 14);
        const len = p.w * 0.62 + Math.sin(now * 5 + i) * 18;
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
    if (p.type === 'perfect' || p.type === 'great') {
      const k = clamp01(age / 0.5);
      if (k < 1) {
        g.save();
        g.globalAlpha = alpha * (1 - k) * 0.8;
        g.lineWidth = 6 * (1 - k) + 1;
        g.strokeStyle = p.type === 'perfect' ? '#fff3b0' : '#b8ffe4';
        pill(g, ANCHOR.x - 30 * k, ANCHOR.y - 18 * k, p.w + 60 * k, h + 36 * k);
        g.stroke();
        g.restore();
      }
    }

    g.translate(cx + dx, cy + dy);
    g.rotate(rot);
    g.scale(scale * sx, scale * sy);
    g.translate(-cx, -cy);
    badge(g, R, ANCHOR.x, ANCHOR.y, p.w, h, now, age, extra);
    g.restore();

    // Particles live in screen space, evaluated from their birth time (frame-rate independent).
    for (const q of p.particles) {
      const t = age;
      if (t > q.life) continue;
      const grav = q.kind === 'drop' ? 900 : q.kind === 'bubble' ? -40 : 220;
      const drag = q.kind === 'star' ? 2.2 : 0.6;
      const k = (1 - Math.exp(-drag * t)) / drag;
      const pos = { ...q, x: q.x + q.vx * k, y: q.y + q.vy * k + 0.5 * grav * t * t, vy: q.vy + grav * t };
      drawParticle(g, pos, t);
    }

    // Not even trying: lazy z's float up from the face.
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
        g.font = `italic 900 ${26 + i * 8}px ${FONT}`;
        // Drift up and to the right, staying inside the frame above the badge.
        const zx = ANCHOR.x + h * 0.7 + zk * 70 + i * 18;
        const zy = ANCHOR.y + 22 - zk * 26 - i * 4;
        g.strokeText('z', zx, zy);
        g.fillText('z', zx, zy);
        g.restore();
      }
    }
    return true;
  }

  function drawCombo(g, now) {
    const y = ANCHOR.y + BADGE_H + 22;
    const x = ANCHOR.x + 14;
    if (combo.n >= 2) {
      const k = clamp01((now - combo.bump) / 0.25);
      const s = 1 + 0.18 * (1 - k) * (1 - k);
      const label = `COMBO ×${combo.n}`;
      g.save();
      g.font = `italic 900 30px ${FONT}`;
      const w = g.measureText(label).width + 48;
      const hh = 48;
      g.translate(x + w / 2, y + hh / 2);
      g.scale(s, s);
      g.translate(-(x + w / 2), -(y + hh / 2));
      g.shadowColor = 'rgba(0, 30, 70, 0.4)';
      g.shadowBlur = 14;
      g.shadowOffsetY = 5;
      pill(g, x, y, w, hh);
      const body = g.createLinearGradient(0, y, 0, y + hh);
      body.addColorStop(0, 'rgba(70, 150, 230, 0.9)');
      body.addColorStop(1, 'rgba(12, 60, 140, 0.92)');
      g.fillStyle = body;
      g.fill();
      g.shadowColor = 'transparent';
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(190, 240, 255, 0.85)';
      g.stroke();
      g.save();
      pill(g, x, y, w, hh);
      g.clip();
      g.fillStyle = 'rgba(255,255,255,0.22)';
      g.fillRect(x, y, w, hh * 0.45);
      g.restore();
      g.fillStyle = '#ffffff';
      g.textBaseline = 'middle';
      g.fillText(label, x + 24, y + hh / 2 + 2);
      g.restore();
    }
    const since = now - combo.broken;
    if (since >= 0 && since < 1.3 && combo.lost >= 2) {
      g.save();
      g.globalAlpha = 1 - clamp01((since - 0.8) / 0.5);
      g.font = `italic 900 26px ${FONT}`;
      g.textBaseline = 'middle';
      g.lineWidth = 6;
      g.strokeStyle = '#5a0b0b';
      g.fillStyle = '#ffd0d0';
      const tx = x + Math.sin(since * 50) * 4 * Math.exp(-since * 6);
      g.strokeText(`COMBO ×${combo.lost} BROKEN`, tx, y + 26 + since * 10);
      g.fillText(`COMBO ×${combo.lost} BROKEN`, tx, y + 26 + since * 10);
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
    const R = RATINGS[type];
    measure.font = `italic 900 ${R.size}px ${FONT}`;
    const w = BADGE_H + 10 + measure.measureText(R.label).width + 46;
    g.save();
    g.translate(ox, oy);
    drawPop(g, { type, born: now - 0.75, leaveAt: Infinity, w, particles: [] }, now);
    g.restore();
  }

  return { trigger, draw, drawSample, combo, setHold(on) { hold = on; } };
}
