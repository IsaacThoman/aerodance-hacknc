// Animated Wii-style channel illustrations, drawn with Canvas 2D every few
// frames. Each draw(ctx, w, h, t, beat) paints the (already clipped) content
// area; keep shapes bold so they read at 640x480.
import { icon, linear, radial, roundRect } from '../../ui/draw.js';

const TAU = Math.PI * 2;

function bg(ctx, w, h, top, bottom) {
  ctx.fillStyle = linear(ctx, 0, 0, 0, h, [
    [0, top],
    [1, bottom],
  ]);
  ctx.fillRect(0, 0, w, h);
}

function rays(ctx, cx, cy, t, count, color, len = 200) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(t * 0.25);
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, len, a, a + (TAU / count) * 0.45);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function sparkle(ctx, x, y, r, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  icon(ctx, 'sparkle', x, y, r * 2, '#ffffff');
  ctx.restore();
}

function softShadow(ctx, x, y, rx, ry, a = 0.18) {
  ctx.save();
  ctx.fillStyle = `rgba(0,30,60,${a})`;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function limb(ctx, pts, width, color) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

// A little Mii-ish dancer: round head, capsule body, swinging limbs.
function dancer(ctx, x, y, s, t, ph, body, skin = '#ffe0c2') {
  const sw = Math.sin(t * Math.PI * 2 * 0.98 + ph);
  const bounce = Math.abs(Math.sin(t * Math.PI * 1.97 + ph)) * 4 * s;
  ctx.save();
  ctx.translate(x, y - bounce);
  softShadow(ctx, 0, 34 * s + bounce, 14 * s, 3.5 * s);
  const out = 'rgba(20,60,110,0.55)';
  // Legs.
  limb(ctx, [[-4 * s, 12 * s], [-8 * s - sw * 4 * s, 24 * s], [-9 * s - sw * 6 * s, 33 * s]], 6.5 * s, '#3c5f8f');
  limb(ctx, [[4 * s, 12 * s], [8 * s + sw * 5 * s, 22 * s], [10 * s + sw * 3 * s, 33 * s]], 6.5 * s, '#3c5f8f');
  // Arms (one up, one swinging).
  limb(ctx, [[-7 * s, -4 * s], [-15 * s, -12 * s - sw * 5 * s], [-19 * s, -24 * s - sw * 4 * s]], 5.5 * s, body);
  limb(ctx, [[7 * s, -4 * s], [16 * s, 2 * s + sw * 7 * s], [22 * s, -6 * s + sw * 9 * s]], 5.5 * s, body);
  // Torso.
  roundRect(ctx, -9 * s, -10 * s, 18 * s, 25 * s, 8 * s);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = out;
  ctx.stroke();
  // Head.
  ctx.beginPath();
  ctx.arc(sw * 1.5 * s, -19 * s, 9.5 * s, 0, TAU);
  ctx.fillStyle = skin;
  ctx.fill();
  ctx.stroke();
  // Hair cap.
  ctx.beginPath();
  ctx.arc(sw * 1.5 * s, -20.5 * s, 9.6 * s, Math.PI * 1.05, Math.PI * 1.95);
  ctx.fillStyle = '#5a3a24';
  ctx.fill();
  // Eyes.
  ctx.fillStyle = '#2a2a35';
  ctx.fillRect(sw * 1.5 * s - 4 * s, -19 * s, 1.8 * s, 3 * s);
  ctx.fillRect(sw * 1.5 * s + 2.4 * s, -19 * s, 1.8 * s, 3 * s);
  ctx.restore();
}

function note(ctx, x, y, s, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.shadowColor = 'rgba(0,50,40,0.35)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1;
  icon(ctx, 'music', 0, 0, s, color);
  ctx.restore();
}

function balloon(ctx, x, y, r, color, t, ph) {
  const sway = Math.sin(t * 1.6 + ph) * 3;
  ctx.save();
  ctx.strokeStyle = 'rgba(90,70,40,0.6)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x + sway, y + r * 1.15);
  ctx.quadraticCurveTo(x - 4, y + r * 1.9, x + sway * 0.3, y + r * 3.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x + sway, y, r * 0.86, r * 1.08, sway * 0.03, 0, TAU);
  ctx.fillStyle = radial(ctx, x + sway - r * 0.3, y - r * 0.4, 1, x + sway, y, r * 1.2, [
    [0, '#ffffff'],
    [0.25, color],
    [1, color],
  ]);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + sway - 3, y + r * 1.12);
  ctx.lineTo(x + sway + 3, y + r * 1.12);
  ctx.lineTo(x + sway, y + r * 1.02);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function gearShape(ctx, x, y, r, teeth, angle, fill, hole = 0.32) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * TAU;
    const rr = i % 2 === 0 ? r : r * 0.78;
    const a0 = a - (Math.PI / (teeth * 2)) * 0.6;
    const a1 = a + (Math.PI / (teeth * 2)) * 0.6;
    ctx.lineTo(Math.cos(a0) * rr, Math.sin(a0) * rr);
    ctx.lineTo(Math.cos(a1) * rr, Math.sin(a1) * rr);
  }
  ctx.closePath();
  ctx.arc(0, 0, r * hole, 0, TAU, true);
  ctx.fillStyle = fill;
  ctx.shadowColor = 'rgba(30,50,80,0.35)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1.5;
  ctx.fill('evenodd');
  ctx.restore();
}

export const CHANNELS = [
  {
    id: 'dance',
    label: 'Dance!',
    accent: '#1e9cf0',
    draw(ctx, w, h, t, b) {
      bg(ctx, w, h, '#d6f3ff', '#58bdf7');
      rays(ctx, w / 2, h * 1.05, t, 14, 'rgba(255,255,255,0.28)');
      // Stage floor.
      ctx.fillStyle = linear(ctx, 0, h * 0.72, 0, h, [
        [0, 'rgba(255,255,255,0.65)'],
        [1, 'rgba(255,255,255,0.1)'],
      ]);
      ctx.beginPath();
      ctx.ellipse(w / 2, h * 0.84, w * 0.45, h * 0.13, 0, 0, TAU);
      ctx.fill();
      dancer(ctx, w * 0.3, h * 0.47, 1.0, b, 0.6, '#ff7ab8');
      dancer(ctx, w * 0.7, h * 0.47, 1.0, b, 2.4, '#ffd23f');
      dancer(ctx, w * 0.5, h * 0.42, 1.12, b, 0, '#3fd17a');
      for (let i = 0; i < 4; i++) {
        const ph = (t * 0.7 + i * 0.27) % 1;
        sparkle(ctx, w * (0.12 + 0.25 * i), h * (0.2 + 0.1 * ((i * 7) % 3)), 4 + 3 * Math.sin(ph * Math.PI), Math.sin(ph * Math.PI));
      }
    },
  },
  {
    id: 'songs',
    label: 'Songs',
    accent: '#34c759',
    draw(ctx, w, h, t, b) {
      bg(ctx, w, h, '#eaffdf', '#7fda6a');
      // Wavy staff.
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.6;
      for (let l = 0; l < 5; l++) {
        ctx.beginPath();
        for (let x = 0; x <= w; x += 6) {
          const y = h * 0.3 + l * 7 + Math.sin(x * 0.05 + t * 2) * 4;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      const cols = ['#ff5fa8', '#2b9bf4', '#ff9f1c', '#7d5cff'];
      for (let i = 0; i < 4; i++) {
        const x = ((w * 0.22 * i + t * 26) % (w + 40)) - 20;
        const hop = Math.abs(Math.sin(b * Math.PI + i * 0.8)) * 10;
        note(ctx, x, h * 0.42 + Math.sin(x * 0.05 + t * 2) * 4 - hop, 26, cols[i]);
      }
      // Headphones badge.
      ctx.save();
      ctx.shadowColor = 'rgba(0,60,20,0.35)';
      ctx.shadowBlur = 4;
      icon(ctx, 'headphones', w * 0.82, h * 0.78, 24, '#ffffff');
      ctx.restore();
    },
  },
  {
    id: 'online',
    label: 'Online',
    accent: '#1fb5d6',
    draw(ctx, w, h, t) {
      bg(ctx, w, h, '#dcfbff', '#3cc6dc');
      const cx = w / 2;
      const cy = h * 0.48;
      const r = h * 0.34;
      // Orbit ring (back half).
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 1.55, r * 0.45, -0.25, Math.PI, TAU);
      ctx.stroke();
      ctx.restore();
      // Globe.
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.fillStyle = radial(ctx, cx - r * 0.35, cy - r * 0.4, 1, cx, cy, r * 1.05, [
        [0, '#9be8ff'],
        [0.6, '#1b8fe0'],
        [1, '#0b5aa8'],
      ]);
      ctx.fill();
      ctx.clip();
      ctx.fillStyle = '#5fd35a';
      const shift = (t * 14) % (r * 4);
      const blobs = [[-0.6, -0.3, 0.45, 0.32], [0.3, 0.25, 0.35, 0.5], [1.2, -0.2, 0.5, 0.35], [2.0, 0.35, 0.3, 0.25], [2.7, -0.35, 0.4, 0.3]];
      for (let k = -1; k <= 0; k++) {
        for (const [bx, by, rx, ry] of blobs) {
          ctx.beginPath();
          ctx.ellipse(cx + (bx * r) + shift + k * r * 4 - r * 1.2, cy + by * r, rx * r, ry * r, 0.4, 0, TAU);
          ctx.fill();
        }
      }
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.ellipse(cx - r * 0.3, cy - r * 0.52, r * 0.55, r * 0.28, -0.3, 0, TAU);
      ctx.fill();
      ctx.restore();
      // Orbit ring (front half) + satellite.
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 1.55, r * 0.45, -0.25, 0, Math.PI);
      ctx.stroke();
      const a = t * 1.4;
      const sx = cx + Math.cos(a) * r * 1.55 * Math.cos(-0.25) - Math.sin(a) * r * 0.45 * Math.sin(-0.25);
      const sy = cy + Math.cos(a) * r * 1.55 * Math.sin(-0.25) + Math.sin(a) * r * 0.45 * Math.cos(-0.25);
      if (Math.sin(a) > -0.2 || Math.hypot(sx - cx, sy - cy) > r) {
        ctx.beginPath();
        ctx.arc(sx, sy, 4.5, 0, TAU);
        ctx.fillStyle = '#ffe14d';
        ctx.fill();
      }
      // Signal arcs.
      for (let i = 0; i < 3; i++) {
        const p = (t * 0.8 + i / 3) % 1;
        ctx.strokeStyle = `rgba(255,255,255,${(1 - p) * 0.9})`;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(w * 0.84, h * 0.24, 6 + p * 16, Math.PI * 1.1, Math.PI * 1.65);
        ctx.stroke();
      }
    },
  },
  {
    id: 'wardrobe',
    label: 'Wardrobe',
    accent: '#ff5fa8',
    draw(ctx, w, h, t) {
      bg(ctx, w, h, '#fff0f7', '#ffa6d2');
      // Rail.
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      roundRect(ctx, w * 0.06, h * 0.13, w * 0.88, 4, 2);
      ctx.fill();
      const items = [['#3fa9f5', 0.27, 0], ['#ffd23f', 0.5, 1.3], ['#7ed957', 0.73, 2.6]];
      for (const [color, fx, ph] of items) {
        const ang = Math.sin(t * 1.8 + ph) * 0.18;
        ctx.save();
        ctx.translate(w * fx, h * 0.15);
        ctx.rotate(ang);
        // Hanger.
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, -1, 3, Math.PI, Math.PI * 2.2);
        ctx.moveTo(0, 2);
        ctx.lineTo(-13, 10);
        ctx.lineTo(13, 10);
        ctx.closePath();
        ctx.stroke();
        ctx.shadowColor = 'rgba(120,20,70,0.3)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 2;
        icon(ctx, 'shirt', 0, 26, 34, color);
        ctx.restore();
      }
      sparkle(ctx, w * 0.88, h * 0.72, 5 + Math.sin(t * 3) * 2, 0.9);
      sparkle(ctx, w * 0.12, h * 0.8, 4 + Math.cos(t * 2.4) * 2, 0.8);
    },
  },
  {
    id: 'party',
    label: 'Party',
    accent: '#ff9f1c',
    draw(ctx, w, h, t) {
      bg(ctx, w, h, '#fff7d1', '#ffc24d');
      rays(ctx, w / 2, h * 0.5, -t * 0.6, 12, 'rgba(255,255,255,0.22)');
      balloon(ctx, w * 0.26, h * 0.32 + Math.sin(t * 1.3) * 3, 11, '#ff5f6d', t, 0);
      balloon(ctx, w * 0.5, h * 0.24 + Math.sin(t * 1.1 + 1) * 3, 12, '#3fa9f5', t, 1.5);
      balloon(ctx, w * 0.74, h * 0.32 + Math.sin(t * 1.5 + 2) * 3, 11, '#7ed957', t, 3);
      // Confetti.
      const cols = ['#ff5fa8', '#3fa9f5', '#ffffff', '#7d5cff', '#ff9f1c'];
      for (let i = 0; i < 18; i++) {
        const x = (i * 37.7) % w;
        const y = ((t * (18 + (i % 5) * 4) + i * 23) % (h + 10)) - 5;
        ctx.save();
        ctx.translate(x + Math.sin(t * 2 + i) * 4, y);
        ctx.rotate(t * 3 + i);
        ctx.fillStyle = cols[i % cols.length];
        ctx.fillRect(-2.5, -1.2, 5, 2.4);
        ctx.restore();
      }
      ctx.save();
      ctx.shadowColor = 'rgba(140,70,0,0.35)';
      ctx.shadowBlur = 4;
      icon(ctx, 'people', w * 0.5, h * 0.78, 30, '#ffffff');
      ctx.restore();
    },
  },
  {
    id: 'practice',
    label: 'Practice',
    accent: '#8a6cf0',
    draw(ctx, w, h, t, b) {
      bg(ctx, w, h, '#f3edff', '#b49cf5');
      // Footprint trail.
      for (let i = 0; i < 6; i++) {
        const lit = Math.floor(b * 2) % 6 === i;
        ctx.fillStyle = lit ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.4)';
        ctx.beginPath();
        ctx.ellipse(w * 0.1 + i * w * 0.075, h * 0.82 - (i % 2) * 8, 4, 6.5, 0.2, 0, TAU);
        ctx.fill();
      }
      // Metronome.
      const mx = w * 0.7;
      const my = h * 0.82;
      ctx.save();
      ctx.shadowColor = 'rgba(60,20,120,0.35)';
      ctx.shadowBlur = 5;
      ctx.shadowOffsetY = 2;
      ctx.beginPath();
      ctx.moveTo(mx - 20, my);
      ctx.lineTo(mx - 8, my - 50);
      ctx.lineTo(mx + 8, my - 50);
      ctx.lineTo(mx + 20, my);
      ctx.closePath();
      ctx.fillStyle = linear(ctx, mx - 20, 0, mx + 20, 0, [
        [0, '#ffffff'],
        [1, '#dcd0ff'],
      ]);
      ctx.fill();
      ctx.restore();
      const swing = Math.sin(b * Math.PI) * 0.55;
      ctx.save();
      ctx.translate(mx, my - 8);
      ctx.rotate(swing);
      ctx.strokeStyle = '#6a4fd8';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -42);
      ctx.stroke();
      ctx.fillStyle = '#ff5fa8';
      roundRect(ctx, -5, -32, 10, 8, 2);
      ctx.fill();
      ctx.restore();
      // Beat pulse ring.
      const p = b % 1;
      ctx.strokeStyle = `rgba(255,255,255,${(1 - p) * 0.8})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(w * 0.3, h * 0.38, 8 + p * 18, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(w * 0.3, h * 0.38, 6 + (1 - p) * 2, 0, TAU);
      ctx.fill();
    },
  },
  {
    id: 'photo',
    label: 'Photo',
    accent: '#2b9bf4',
    draw(ctx, w, h, t) {
      bg(ctx, w, h, '#e9f6ff', '#8fcaff');
      // Polaroids fanned behind.
      const pol = (x, y, a, sky) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        ctx.shadowColor = 'rgba(0,40,90,0.3)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 2;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-15, -17, 30, 34);
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = sky;
        ctx.fillRect(-12, -14, 24, 21);
        ctx.fillStyle = '#6fcf4a';
        ctx.beginPath();
        ctx.ellipse(-2, 7, 16, 7, 0, Math.PI, TAU);
        ctx.fill();
        ctx.restore();
      };
      pol(w * 0.2, h * 0.5, -0.25, '#9fdcff');
      pol(w * 0.8, h * 0.48, 0.22, '#ffd1e8');
      // Camera body.
      const cx = w / 2;
      const cy = h * 0.5;
      ctx.save();
      ctx.shadowColor = 'rgba(0,40,90,0.35)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 2;
      roundRect(ctx, cx - 26, cy - 15, 52, 34, 8);
      ctx.fillStyle = linear(ctx, 0, cy - 15, 0, cy + 19, [
        [0, '#ffffff'],
        [1, '#cfe3f5'],
      ]);
      ctx.fill();
      ctx.restore();
      roundRect(ctx, cx - 10, cy - 21, 20, 8, 3);
      ctx.fillStyle = '#e8f2fb';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy + 2, 12, 0, TAU);
      ctx.fillStyle = radial(ctx, cx - 4, cy - 2, 1, cx, cy + 2, 12, [
        [0, '#9fe0ff'],
        [0.5, '#1b6fc2'],
        [1, '#0a3366'],
      ]);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Flash every ~3s.
      const f = t % 3.2;
      if (f < 0.5) {
        const k = 1 - f / 0.5;
        ctx.fillStyle = `rgba(255,255,255,${k * 0.85})`;
        ctx.fillRect(0, 0, w, h);
        sparkle(ctx, cx + 18, cy - 18, 8 * (0.5 + k), k);
      }
    },
  },
  {
    id: 'settings',
    label: 'Settings',
    accent: '#7d8ea0',
    draw(ctx, w, h, t) {
      bg(ctx, w, h, '#f8fafc', '#c9d4de');
      // Wii-style faint stripes.
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      for (let y = 0; y < h; y += 6) ctx.fillRect(0, y, w, 2);
      gearShape(ctx, w * 0.4, h * 0.48, 22, 10, t * 0.8, '#8fa2b5');
      gearShape(ctx, w * 0.4 + 33, h * 0.48 - 14, 14, 8, -t * 0.8 * (10 / 8) + 0.2, '#34beed');
      gearShape(ctx, w * 0.4 + 30, h * 0.48 + 22, 11, 7, -t * 0.8 * (10 / 7), '#b7c4d1');
    },
  },
];
