import { useCallback, useMemo, useRef } from 'react';
import QRCode from 'qrcode';
import {
  FONT, drawBubble, drawCaps, drawGlassPanel, drawHeader, drawPill, drawQR, drawShadowText, ellipsize, roundRect,
} from '../ui/draw.js';
import { drawSticker, stickerLabel } from '../ui/stickers.js';
import useCanvasUI from '../ui/useCanvasUI.js';
import { joinUrl, useHype } from './api.js';

/**
 * The game display's side of a battle, drawn in-engine over the world and the menu
 * dancers (useFrame priority 2.5). Phases follow the battle:
 *   lobby    QR code to join, seat tags over the dancers, Start
 *   playing  seat tags and hype only (the dance itself hooks in here)
 *   results  winner, scores, hype totals, the on-chain receipt and the winner's trophy NFT
 * Hype from phones rises as bubbles from the dancer it was sent to; stickers rise as themselves.
 *
 * <BattleScreen visible battle={publicBattle} playing onPlay onBack onRematch onMenu />
 */

const BACK = { x: 166, y: 134, r: 30 };
const QR_PANEL = { x: 128, y: 190, w: 452, h: 540 };
const QR_BOX = { x: 164, y: 246, w: 380, h: 380 };
const START = { x: 128, y: 760, w: 452, h: 100 };
// Over the heads of the two menu dancers.
const SEAT_X = [1050, 1325];
const TAG_Y = 286;
const BUBBLE_Y = 640;

// Score cards share the space between the banner and the receipt line.
const CARDS = { x: 128, y: 300, w: 600, h: 256, gap: 16 };
const cardRect = (i, n) => {
  const h = Math.min(112, (CARDS.h - CARDS.gap * (n - 1)) / n);
  return { x: CARDS.x, y: CARDS.y + i * (h + CARDS.gap), w: CARDS.w, h };
};
const RECEIPT = { x: 128, y: 580, w: 600, h: 64 };
const TROPHY = { x: 128, y: 660, w: 600, h: 64 };
const REMATCH = { x: 128, y: 760, w: 380, h: 100 };
const MENU = { x: 524, y: 760, w: 290, h: 100 };

const seatX = (seat, count) => (count <= 2 ? SEAT_X[seat] : 960 + (seat * 520) / (count - 1));
const fmtSol = (sol) => `${Number(sol.toFixed(3))} SOL`;
const fmtClock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const short = (sig) => `${sig.slice(0, 4)}…${sig.slice(-4)}`;

function phaseOf(battle, playing) {
  if (battle?.status === 'finished') return 'results';
  return playing ? 'playing' : 'lobby';
}

function drawSeatTag(g, x, y, { name, sub, gold, dim }) {
  g.save();
  g.font = `700 34px ${FONT}`;
  const label = ellipsize(g, name, 300);
  const w = Math.max(190, g.measureText(label).width + 64);
  const rect = { x: x - w / 2, y: y - 32, w, h: 64 };
  g.globalAlpha *= dim ? 0.75 : 1;
  drawGlassPanel(g, rect, 32);
  if (gold) {
    roundRect(g, rect.x - 3, rect.y - 3, rect.w + 6, rect.h + 6, 35);
    g.lineWidth = 5;
    g.strokeStyle = '#ffd34d';
    g.stroke();
  }
  g.restore();
  drawShadowText(g, label, x, y + 1, { size: 34, align: 'center', alpha: dim ? 0.8 : 1 });
  if (sub) drawShadowText(g, sub, x, y + 58, { size: 24, weight: 600, align: 'center' });
}

function drawScoreCard(g, rect, player, { winner }) {
  const k = rect.h / 112;
  drawGlassPanel(g, rect, 30 * k);
  if (winner) {
    roundRect(g, rect.x - 3, rect.y - 3, rect.w + 6, rect.h + 6, 33);
    g.lineWidth = 5;
    g.strokeStyle = '#ffd34d';
    g.stroke();
  }
  const r = player.result;
  g.save();
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.font = `700 ${34 * k}px ${FONT}`;
  g.fillText(ellipsize(g, player.name ?? `Seat ${player.seat + 1}`, 330), rect.x + 32, rect.y + 40 * k);
  g.font = `600 ${22 * k}px ${FONT}`;
  g.fillStyle = 'rgba(255,255,255,0.8)';
  const detail = r ? `pops ${r.pops} · sync ${r.sync.toFixed(2)} · flair ${r.flair}` : 'no score this round';
  g.fillText(detail, rect.x + 32, rect.y + 80 * k);
  g.textAlign = 'right';
  g.font = `800 ${52 * k}px ${FONT}`;
  g.fillStyle = winner ? '#ffe27a' : '#ffffff';
  g.fillText(r ? String(r.score) : '–', rect.x + rect.w - 32, rect.y + 44 * k);
  g.font = `600 ${22 * k}px ${FONT}`;
  g.fillStyle = 'rgba(255,255,255,0.8)';
  g.fillText(`${player.hype.count} hype · ${fmtSol(player.hype.sol)}`, rect.x + rect.w - 32, rect.y + 86 * k);
  g.restore();
}

export default function BattleScreen({ visible, battle, playing, onPlay, onBack, onRematch, onMenu }) {
  const props = useRef({});
  props.current = { visible, battle, playing, onPlay, onBack, onRematch, onMenu };
  const st = useRef({ alpha: 0, bubbles: [], phase: null, seen: null }).current;

  const id = battle?.id;
  const url = id ? joinUrl(id) : null;
  const qr = useMemo(() => (url ? QRCode.create(url, { errorCorrectionLevel: 'M' }).modules : null), [url]);
  const qrRef = useRef(qr);
  qrRef.current = qr;

  const spawn = (x, count, { label, sticker, spread = 70, y = BUBBLE_Y } = {}) => {
    for (let i = 0; i < count; i++) {
      st.bubbles.push({
        x: x + (Math.random() - 0.5) * spread * 2,
        y: y + Math.random() * 40,
        r: i === 0 && sticker ? 58 : 14 + Math.random() * 24,
        sticker: i === 0 ? sticker : undefined,
        vy: -(140 + Math.random() * 120),
        wobble: Math.random() * Math.PI * 2,
        age: -i * 0.07,
        life: 3 + Math.random() * 1.5,
        label: i === 0 ? label : undefined,
      });
    }
  };

  useHype(id, useCallback(({ seat, from, sticker }) => {
    const count = props.current.battle?.players.length ?? 2;
    const label = sticker ? `${from} sent a ${stickerLabel(sticker)} sticker` : `+hype from ${from}`;
    spawn(seatX(seat, count), sticker ? 4 : 6, { label, sticker });
  }, []));

  const widgetsFor = (phase, b) => {
    if (phase === 'lobby') return [{ id: 'back', circle: BACK }, { id: 'start', rect: START }];
    if (phase === 'playing') return [{ id: 'back', circle: BACK }];
    const list = [{ id: 'menu-back', circle: BACK }, { id: 'rematch', rect: REMATCH }, { id: 'menu', rect: MENU }];
    if (b?.receipt?.explorer) list.push({ id: 'receipt', rect: RECEIPT });
    if (b?.trophy?.explorer) list.push({ id: 'trophy', rect: TROPHY });
    return list;
  };

  useCanvasUI({
    priority: 2.5,
    active: () => props.current.visible && !!props.current.battle?.players && st.alpha > 0.3,
    widgets: () => widgetsFor(phaseOf(props.current.battle, props.current.playing), props.current.battle),
    onActivate: (wdg) => {
      const p = props.current;
      switch (wdg.id) {
        case 'start': p.onPlay?.(); break;
        case 'back': p.onBack?.(); break;
        case 'menu-back':
        case 'menu': p.onMenu?.(); break;
        case 'rematch': p.onRematch?.(); break;
        case 'receipt': window.open(p.battle.receipt.explorer, '_blank', 'noopener'); break;
        case 'trophy': window.open(p.battle.trophy.explorer, '_blank', 'noopener'); break;
        default:
      }
    },
    onKey: (e) => {
      const p = props.current;
      if (e.key !== 'Escape' || !p.visible) return;
      if (phaseOf(p.battle, p.playing) === 'results') p.onMenu?.();
      else p.onBack?.();
    },
    update: (dt, s) => {
      const p = props.current;
      st.alpha = s.ease(st.alpha, p.visible && p.battle?.players ? 1 : 0, p.visible ? 3 : 6);
      const phase = phaseOf(p.battle, p.playing);
      if (phase !== st.phase) { st.phase = phase; s.invalidate(); }
      // Celebrate when a battle finishes while we're watching it.
      if (p.battle?.status) {
        if (st.seen?.id === p.battle.id && st.seen.status === 'open' && p.battle.status === 'finished') {
          for (let i = 0; i < 6; i++) spawn(200 + i * 260, 5, { spread: 120, y: 940 });
        }
        st.seen = { id: p.battle.id, status: p.battle.status };
      }
      for (const b of st.bubbles) {
        b.age += dt;
        b.y += b.vy * dt * (b.age > 0 ? 1 : 0);
      }
      st.bubbles = st.bubbles.filter((b) => b.age < b.life && b.y > -60);
      // Bubbles, countdowns and the receipt spinner animate; everything else is static.
      if (st.bubbles.length || p.battle?.closesAt || p.battle?.receipt?.status === 'pending' || p.battle?.trophy?.status === 'pending') {
        s.invalidate();
      }
    },
    opacity: () => st.alpha,
    draw: (g, s) => {
      const p = props.current;
      const b = p.battle;
      if (!b?.players) return;
      const phase = phaseOf(b, p.playing);
      const h = s.hover;
      const count = b.players.length;

      if (phase === 'lobby') {
        drawHeader(g, BACK, `BATTLE ${b.id.toUpperCase()}`, h.back ?? 0);
        drawGlassPanel(g, QR_PANEL, 34);
        drawCaps(g, 'SCAN TO JOIN', QR_PANEL.x + QR_PANEL.w / 2, QR_PANEL.y + 32, { size: 24, align: 'center' });
        roundRect(g, QR_BOX.x - 4, QR_BOX.y - 4, QR_BOX.w + 8, QR_BOX.h + 8, 22);
        g.fillStyle = '#ffffff';
        g.fill();
        if (qrRef.current) drawQR(g, qrRef.current, QR_BOX, s);
        const host = url.replace(/^https?:\/\//, '');
        g.font = `700 26px ${FONT}`;
        drawShadowText(g, ellipsize(g, host, QR_PANEL.w - 40), QR_PANEL.x + QR_PANEL.w / 2, QR_BOX.y + QR_BOX.h + 40, { size: 26, align: 'center' });
        // Local dev only: phones can't follow a localhost QR code.
        if (/^(localhost|127\.|\[::1\])/.test(location.hostname)) {
          drawShadowText(g, "Phones can't open localhost: use a LAN IP", QR_PANEL.x + QR_PANEL.w / 2, QR_BOX.y + QR_BOX.h + 80, {
            size: 21, weight: 600, align: 'center', color: '#ffe27a',
          });
        }
        const ready = b.players.filter((pl) => pl.name).length;
        drawPill(g, START, {
          label: 'Start battle',
          sub: ready ? `${ready} of ${count} dancers ready` : 'waiting for dancers',
          icon: 'play',
          hover: h.start ?? 0,
          press: s.press * (h.start ?? 0),
        });
      } else if (phase === 'playing') {
        drawHeader(g, BACK, `BATTLE ${b.id.toUpperCase()}`, h.back ?? 0);
      }

      if (phase === 'results') {
        drawHeader(g, BACK, 'RESULTS', h['menu-back'] ?? 0);
        const w = b.winnerSeat;
        const winner = w === null ? null : b.players[w];
        drawShadowText(g, winner ? `${winner.name ?? `Seat ${w + 1}`} wins!` : "It's a tie!", 128, 250, { size: 76, weight: 800 });
        b.players.forEach((pl, i) => drawScoreCard(g, cardRect(i, count), pl, { winner: pl.seat === w }));
        const dots = '.'.repeat(1 + (Math.floor(s.time * 3) % 3));
        const chip = (rect, label, link, hover) => {
          g.save();
          g.globalAlpha *= 0.85 + hover * 0.15;
          drawGlassPanel(g, rect, rect.h / 2);
          g.restore();
          drawShadowText(g, label, rect.x + 32, rect.y + rect.h / 2 + 1, {
            size: 26, weight: 700, color: link && !hover ? '#bff4ff' : '#ffffff',
          });
        };
        const confirmed = b.receipt?.status === 'confirmed';
        chip(RECEIPT, confirmed ? `On-chain receipt ${short(b.receipt.signature)}  ↗` : `Writing the on-chain receipt${dots}`, confirmed, h.receipt ?? 0);
        if (b.trophy) {
          const minted = b.trophy.status === 'minted';
          chip(TROPHY, minted ? `Winner's trophy NFT ${short(b.trophy.asset)}  ↗` : `Minting the winner's trophy NFT${dots}`, minted, h.trophy ?? 0);
        }
        drawPill(g, REMATCH, { label: 'Run it back', icon: 'replay', hover: h.rematch ?? 0, press: s.press * (h.rematch ?? 0) });
        drawPill(g, MENU, { label: 'Menu', icon: 'home', hover: h.menu ?? 0, press: s.press * (h.menu ?? 0) });
      }

      // Seat tags over the dancers.
      b.players.forEach((pl) => {
        const x = seatX(pl.seat, count);
        const hype = pl.hype.count ? `${pl.hype.count} hype · ${fmtSol(pl.hype.sol)}` : null;
        if (phase === 'results') {
          drawSeatTag(g, x, TAG_Y, {
            name: pl.name ?? `Seat ${pl.seat + 1}`,
            sub: pl.result ? `${pl.result.score} pts` : 'no score',
            gold: pl.seat === b.winnerSeat,
          });
        } else if (pl.name) {
          drawSeatTag(g, x, TAG_Y, { name: pl.name, sub: pl.result ? 'score in' : hype });
        } else {
          drawSeatTag(g, x, TAG_Y, { name: 'Open seat', sub: 'scan to dance', dim: true });
        }
      });

      // Footer under the stage: crowd size and the results countdown.
      const footer = [];
      if (b.spectators) footer.push(`${b.spectators} in the crowd`);
      if (b.closesAt) footer.push(`scores close in ${fmtClock(Date.parse(b.closesAt) - Date.now())}`);
      if (footer.length && phase !== 'results') {
        drawCaps(g, footer.join(' · ').toUpperCase(), (SEAT_X[0] + SEAT_X[1]) / 2, 850, { size: 22, align: 'center' });
      }

      for (const bubble of st.bubbles) {
        if (bubble.age < 0) continue;
        const fade = Math.min(1, bubble.age * 4) * Math.min(1, (bubble.life - bubble.age) * 1.5);
        const x = bubble.x + Math.sin(bubble.age * 2.4 + bubble.wobble) * 14;
        if (bubble.sticker) {
          g.save();
          g.globalAlpha *= fade;
          drawSticker(g, bubble.sticker, x, bubble.y, bubble.r * 2, () => s.invalidate());
          g.restore();
        } else {
          drawBubble(g, x, bubble.y, bubble.r, fade);
        }
        if (bubble.label) {
          // Keep the label on screen above dancers near the edge.
          g.font = `800 26px ${FONT}`;
          const half = g.measureText(bubble.label).width / 2 + 24;
          const lx = Math.min(s.w - half, Math.max(half, x));
          drawShadowText(g, bubble.label, lx, bubble.y - bubble.r - 22, { size: 26, weight: 800, align: 'center', alpha: fade });
        }
      }
    },
  });

  return null;
}
