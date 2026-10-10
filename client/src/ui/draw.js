// Frutiger Aero drawing kit for the in-engine 2D overlays. Everything takes design units;
// useCanvasUI scales them to the render buffer.

export const FONT = '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif';
export const NAVY = '#0c2f52';
export const TAU = Math.PI * 2;

// Canvas text needs the web font resident before it is drawn.
export const loadFonts = () =>
  Promise.all(['800', '700', '600', '200'].map((wt) => document.fonts.load(`${wt} 64px ${FONT}`))).catch(() => {});

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

export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

// "aerodance." wordmark with its baseline at y.
export function drawTitle(g, { x, y, size }) {
  g.save();
  if ('letterSpacing' in g) g.letterSpacing = `${-size * 0.045}px`;
  g.textBaseline = 'alphabetic';
  g.font = `800 ${size}px ${FONT}`;
  const aeroW = g.measureText('aero').width;
  g.font = `200 ${size}px ${FONT}`;
  const danceW = g.measureText('dance').width;
  const s = size * 0.15;
  const dotX = x + aeroW + danceW + size * 0.04;

  const text = (fill) => {
    g.fillStyle = fill;
    g.font = `800 ${size}px ${FONT}`;
    g.fillText('aero', x, y);
    g.font = `200 ${size}px ${FONT}`;
    g.fillText('dance', x + aeroW, y);
  };

  // 1) Wide, dark halo so the title separates from bright sky and clouds.
  g.shadowColor = 'rgba(0, 28, 70, 0.55)';
  g.shadowBlur = 46;
  g.shadowOffsetY = 10;
  text('rgba(0, 40, 90, 0.35)');
  // 2) Tight, hard drop shadow for an embossed, aero-style edge.
  g.shadowColor = 'rgba(0, 34, 84, 0.75)';
  g.shadowBlur = 4;
  g.shadowOffsetY = 7;
  text('#ffffff');
  // 3) Glossy face: white with a cool tint towards the baseline.
  g.shadowColor = 'transparent';
  const face = g.createLinearGradient(0, y - size * 0.75, 0, y);
  face.addColorStop(0, '#ffffff');
  face.addColorStop(0.55, '#ffffff');
  face.addColorStop(1, '#d5f3ff');
  text(face);

  // Mint full stop.
  g.shadowColor = 'rgba(0, 34, 84, 0.75)';
  g.shadowBlur = 4;
  g.shadowOffsetY = 7;
  g.fillStyle = '#6ff3d6';
  g.fillRect(dotX, y - s, s, s);
  g.restore();
}

export function titleWidth(g, size) {
  g.save();
  if ('letterSpacing' in g) g.letterSpacing = `${-size * 0.045}px`;
  g.font = `800 ${size}px ${FONT}`;
  const aeroW = g.measureText('aero').width;
  g.font = `200 ${size}px ${FONT}`;
  const danceW = g.measureText('dance').width;
  g.restore();
  return aeroW + danceW + size * 0.19;
}

export function drawDisc(g, cx, cy, r) {
  g.save();
  g.shadowColor = 'rgba(0, 60, 120, 0.4)';
  g.shadowBlur = 10;
  g.shadowOffsetY = 3;
  g.beginPath();
  g.arc(cx, cy, r, 0, TAU);
  const disc = g.createLinearGradient(0, cy - r, 0, cy + r);
  disc.addColorStop(0, '#5cc2ec');
  disc.addColorStop(0.5, '#1f8fd0');
  disc.addColorStop(1, '#0d63a8');
  g.fillStyle = disc;
  g.fill();
  g.restore();
  g.beginPath();
  g.ellipse(cx, cy - r * 0.45, r * 0.75, r * 0.42, 0, 0, TAU);
  g.fillStyle = 'rgba(255,255,255,0.22)';
  g.fill();
}

// Icons drawn in white on a blue disc of radius r.
export const ICONS = {
  play(g, cx, cy, r) {
    const t = r * 0.42;
    g.beginPath();
    g.moveTo(cx - t * 0.7, cy - t);
    g.lineTo(cx + t, cy);
    g.lineTo(cx - t * 0.7, cy + t);
    g.closePath();
    g.stroke();
  },
  // Two crossing strands with solid arrowheads; the strand on top gets a
  // disc-coloured gap so the crossing still reads at 640x480.
  shuffle(g, cx, cy, r) {
    const a = r * 0.56;
    const b = r * 0.3;
    const hw = r * 0.2;
    const tip = cx + a;
    const neck = tip - hw * 1.3;
    const strand = (y0, y1) => {
      g.beginPath();
      g.moveTo(cx - a, y0);
      g.lineTo(cx - a * 0.35, y0);
      g.lineTo(cx + a * 0.25, y1);
      g.lineTo(neck, y1);
      g.stroke();
    };
    const head = (y) => {
      g.beginPath();
      g.moveTo(tip, y);
      g.lineTo(neck, y - hw);
      g.lineTo(neck, y + hw);
      g.closePath();
      g.fill();
    };
    g.save();
    g.fillStyle = '#ffffff';
    g.lineWidth = 5;
    g.lineJoin = 'miter';
    g.lineCap = 'butt';
    strand(cy - b, cy + b);
    head(cy + b);
    g.strokeStyle = '#1f8fd0';
    g.lineWidth = 12;
    strand(cy + b, cy - b);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 5;
    strand(cy + b, cy - b);
    head(cy - b);
    g.restore();
  },
  note(g, cx, cy, r) {
    const s = r * 0.5;
    g.save();
    g.fillStyle = '#ffffff';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(cx - s * 0.35, cy + s * 0.6);
    g.lineTo(cx - s * 0.35, cy - s * 0.75);
    g.lineTo(cx + s * 0.75, cy - s);
    g.lineTo(cx + s * 0.75, cy + s * 0.35);
    g.stroke();
    for (const [x, y] of [[cx - s * 0.62, cy + s * 0.62], [cx + s * 0.48, cy + s * 0.37]]) {
      g.beginPath();
      g.ellipse(x, y, s * 0.32, s * 0.24, -0.4, 0, TAU);
      g.fill();
    }
    g.restore();
  },
  list(g, cx, cy, r) {
    const a = r * 0.44;
    g.beginPath();
    for (const dy of [-a * 0.7, 0, a * 0.7]) {
      g.moveTo(cx - a * 0.55, cy + dy);
      g.lineTo(cx + a, cy + dy);
      g.moveTo(cx - a, cy + dy);
      g.lineTo(cx - a * 0.92, cy + dy);
    }
    g.stroke();
  },
  gear(g, cx, cy, r, angle = 0) {
    const teeth = 8;
    const outer = r * 0.5;
    const inner = r * 0.37;
    g.save();
    g.translate(cx, cy);
    g.rotate(angle);
    g.lineWidth = 5;
    g.beginPath();
    for (let i = 0; i < teeth * 2; i++) {
      const a0 = (i / (teeth * 2)) * TAU;
      const a1 = ((i + 1) / (teeth * 2)) * TAU;
      const rad = i % 2 === 0 ? outer : inner;
      g.lineTo(Math.cos(a0) * rad, Math.sin(a0) * rad);
      g.lineTo(Math.cos(a1) * rad, Math.sin(a1) * rad);
    }
    g.closePath();
    g.stroke();
    g.beginPath();
    g.arc(0, 0, r * 0.15, 0, TAU);
    g.stroke();
    g.restore();
  },
};

// Glossy aqua bubble button with an icon disc on the left.
export function drawPill(g, rect, { label, sub, icon, hover, press, angle }) {
  const lift = hover * 3 - press * 3;
  const { x, w, h } = rect;
  const y = rect.y - lift;

  g.save();
  g.shadowColor = `rgba(0, 50, 110, ${0.4 + hover * 0.1})`;
  g.shadowBlur = 24 + hover * 10;
  g.shadowOffsetY = 8;
  pill(g, x, y, w, h);
  const body = g.createLinearGradient(0, y, 0, y + h);
  body.addColorStop(0, '#f4feff');
  body.addColorStop(0.48, `rgb(${200 + hover * 20}, ${244 + hover * 6}, 255)`);
  body.addColorStop(0.52, '#a9ecf6');
  body.addColorStop(1, '#7fdcef');
  g.fillStyle = body;
  g.fill();
  g.restore();

  // Glossy upper sheen.
  g.save();
  pill(g, x, y, w, h);
  g.clip();
  const sheen = g.createLinearGradient(0, y, 0, y + h * 0.5);
  sheen.addColorStop(0, 'rgba(255,255,255,0.85)');
  sheen.addColorStop(1, 'rgba(255,255,255,0.15)');
  g.fillStyle = sheen;
  pill(g, x + 10, y + 5, w - 20, h * 0.46);
  g.fill();
  g.restore();

  pill(g, x, y, w, h);
  g.lineWidth = 4;
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.stroke();

  const cx = x + h / 2 + 2;
  const cy = y + h / 2;
  const r = h / 2 - 12;
  drawDisc(g, cx, cy, r);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.lineWidth = 6;
  g.strokeStyle = '#ffffff';
  ICONS[icon](g, cx, cy, r, angle);

  g.fillStyle = NAVY;
  g.font = `700 ${Math.round(h * (sub ? 0.34 : 0.4))}px ${FONT}`;
  g.textBaseline = 'middle';
  if ('letterSpacing' in g) g.letterSpacing = '-1px';
  g.fillText(label, x + h + 14, sub ? cy - h * 0.13 : cy + 2);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  if (sub) {
    g.fillStyle = 'rgba(12, 47, 82, 0.7)';
    g.font = `600 ${Math.round(h * 0.22)}px ${FONT}`;
    g.fillText(sub, x + h + 15, cy + h * 0.2);
  }
}

export function drawGlassCircle(g, c, hover) {
  g.save();
  g.shadowColor = 'rgba(0, 34, 84, 0.45)';
  g.shadowBlur = 16;
  g.shadowOffsetY = 4;
  g.beginPath();
  g.arc(c.x, c.y, c.r, 0, TAU);
  g.fillStyle = `rgba(20, 90, 160, ${0.35 + hover * 0.15})`;
  g.fill();
  g.restore();
  g.beginPath();
  g.arc(c.x, c.y, c.r, 0, TAU);
  g.lineWidth = 3;
  g.strokeStyle = `rgba(255,255,255,${0.65 + hover * 0.35})`;
  g.stroke();
  g.beginPath();
  g.ellipse(c.x, c.y - c.r * 0.45, c.r * 0.7, c.r * 0.38, 0, 0, TAU);
  g.fillStyle = 'rgba(255,255,255,0.16)';
  g.fill();
}

// Submenu header: glass back button (circle `back`) and a small-caps heading beside it.
export function drawHeader(g, back, label, hover) {
  const { x, y, r } = back;
  drawGlassCircle(g, back, hover);
  const a = r * 0.4 + hover * 2;
  g.beginPath();
  g.moveTo(x + a, y);
  g.lineTo(x - a, y);
  g.moveTo(x - a + 11, y - 11);
  g.lineTo(x - a, y);
  g.lineTo(x - a + 11, y + 11);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = 4;
  g.strokeStyle = '#ffffff';
  g.stroke();

  drawCaps(g, label, x + r + 22, y + 1);
}

// White small-caps label with a navy drop shadow (headers, panel titles).
export function drawCaps(g, label, x, y, { size = 26, align = 'left' } = {}) {
  g.save();
  g.font = `800 ${size}px ${FONT}`;
  if ('letterSpacing' in g) g.letterSpacing = `${Math.round(size * 0.23)}px`;
  g.textBaseline = 'middle';
  g.textAlign = align;
  g.shadowColor = 'rgba(0, 34, 84, 0.7)';
  g.shadowBlur = 6;
  g.shadowOffsetY = 3;
  g.fillStyle = '#ffffff';
  g.fillText(label, x, y);
  g.restore();
}

// Deep-blue glass panel (the settings panel look) for cards and sheets.
export function drawGlassPanel(g, { x, y, w, h }, radius = 34) {
  g.save();
  g.shadowColor = 'rgba(0, 30, 80, 0.45)';
  g.shadowBlur = 30;
  g.shadowOffsetY = 10;
  roundRect(g, x, y, w, h, radius);
  const body = g.createLinearGradient(0, y, 0, y + h);
  body.addColorStop(0, 'rgba(34, 120, 196, 0.82)');
  body.addColorStop(1, 'rgba(6, 52, 116, 0.88)');
  g.fillStyle = body;
  g.fill();
  g.restore();
  g.save();
  roundRect(g, x, y, w, h, radius);
  g.clip();
  const sheen = g.createLinearGradient(0, y, 0, y + 70);
  sheen.addColorStop(0, 'rgba(255,255,255,0.28)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sheen;
  g.fillRect(x, y, w, 70);
  g.restore();
  roundRect(g, x, y, w, h, radius);
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(255,255,255,0.6)';
  g.stroke();
}
