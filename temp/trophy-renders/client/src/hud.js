import { FONT, NAVY, drawMedal, drawTitle, roundRect } from '../../../../client/src/ui/draw.js';
import { BUFFER, DESIGN } from './shots.js';

const GOLD = '#ffd34d';

/** The stage name card's glass pill (temp/win-screens WinHud's glassPill). */
function glassPill(g, x, y, w, h, { rim = null } = {}) {
  const r = h / 2;
  g.save();
  g.shadowColor = 'rgba(0,40,80,0.35)';
  g.shadowBlur = 14;
  g.shadowOffsetY = 4;
  roundRect(g, x, y, w, h, r);
  const body = g.createLinearGradient(0, y, 0, y + h);
  body.addColorStop(0, 'rgba(255,255,255,0.94)');
  body.addColorStop(0.5, 'rgba(214,246,255,0.86)');
  body.addColorStop(0.51, 'rgba(176,232,250,0.82)');
  body.addColorStop(1, 'rgba(222,252,255,0.9)');
  g.fillStyle = body;
  g.fill();
  g.shadowColor = 'transparent';
  g.lineWidth = 2.5;
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.stroke();
  roundRect(g, x + 16, y + 3, w - 32, h * 0.42, h * 0.2);
  const sheen = g.createLinearGradient(0, y + 3, 0, y + h * 0.45);
  sheen.addColorStop(0, 'rgba(255,255,255,0.9)');
  sheen.addColorStop(1, 'rgba(255,255,255,0.08)');
  g.fillStyle = sheen;
  g.fill();
  if (rim) {
    g.shadowColor = rim;
    g.shadowBlur = 16;
    roundRect(g, x - 3, y - 3, w + 6, h + 6, r + 3);
    g.lineWidth = 5;
    g.strokeStyle = rim;
    g.stroke();
  }
  g.restore();
}

function text(g, str, x, y, { size, weight, align = 'left', alpha = 1, spacing = 0 }) {
  g.save();
  g.font = `${weight} ${size}px ${FONT}`;
  if ('letterSpacing' in g) g.letterSpacing = `${spacing}px`;
  g.textAlign = align;
  g.textBaseline = 'alphabetic';
  g.globalAlpha = alpha;
  g.fillStyle = NAVY;
  g.fillText(str, x, y);
  g.restore();
}

/**
 * The trophy's 2D layer on a buffer-sized canvas: the title screen's wordmark, the battle
 * chip and a name card with the winner's medal, stage, trophy and score.
 */
export function drawHud(battle, traits) {
  const canvas = document.createElement('canvas');
  canvas.width = BUFFER.width;
  canvas.height = BUFFER.height;
  const g = canvas.getContext('2d');
  g.setTransform(BUFFER.width / DESIGN.width, 0, 0, BUFFER.height / DESIGN.height, 0, 0);

  drawTitle(g, { x: 56, y: 116, size: 76 });

  glassPill(g, 770, 66, 176, 52);
  text(g, `#${battle.id}`, 858, 101, { size: 26, weight: 800, align: 'center' });

  const finish = traits.finish === 'Glass' ? 'glass' : traits.finish.toLowerCase();
  glassPill(g, 84, 860, 832, 104, { rim: traits.aura ? GOLD : null });
  drawMedal(g, 146, 912, 38);
  text(g, traits.stage.name, 204, 904, { size: 36, weight: 700, spacing: -0.5 });
  text(g, `${traits.glass} ${finish} ${traits.cup.toLowerCase()} · ${battle.created_at.toISOString().slice(0, 10)}`, 205, 940, { size: 21, weight: 600, alpha: 0.7 });
  text(g, 'SCORE', 878, 896, { size: 15, weight: 800, align: 'right', alpha: 0.6, spacing: 3 });
  text(g, String(battle.score), 878, 942, { size: 50, weight: 800, align: 'right', spacing: -1 });
  return canvas;
}
