import { useRef } from 'react';
import {
  FONT, NAVY, drawBubble, drawCaps, drawGlassPanel, drawMedal, drawPill, drawPlayerLeds, drawSparkle, drawSunburst,
  drawTitle, ellipsize, roundRect, titleWidth, wrapText,
} from '../ui/draw.js';
import { FAKE_DANCE_MS } from '../battle/fakeDance.js';
import { STICKERS, drawSticker } from '../ui/stickers.js';
import useCanvasUI from '../ui/useCanvasUI.js';

/**
 * The phone view, drawn in-engine like the display's menus: one scrolling column laid out
 * 720 design units wide, as tall as the phone's aspect allows. Sections: the profile form,
 * the battle, your stats and wallet, and an Add to Home Screen hint.
 *
 * The battle shows rather than tells: your player number lit on a Wii remote's LEDs, the
 * dance as a filling bar with the dancers bobbing, and the winner's card in a sunburst
 * with a medal (the winner's whole screen celebrates).
 *
 * Text fields are real <input>s (so the phone keyboard opens) kept invisible over the
 * drawn fields; their values and focus are drawn here.
 */

export const PHONE_W = 720;
const M = 36; // side margin
const CW = PHONE_W - M * 2;
const PAD = 32; // inside panels

const fmtSol = (sol) => `${Number(sol.toFixed(3))} SOL`;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const popIn = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : 1 + 2.7 * (k - 1) ** 3 + 1.7 * (k - 1) ** 2);
const CELEBRATE_S = 6;
const shortAddr = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const IMESSAGE = {
  registered: ['iMessage linked', '#7affdc'],
  pending: ['Linking iMessage…', '#bff4ff'],
  optin: ['One step left', '#ffe27a'],
  failed: ["Couldn't link iMessage", '#ffb38a'],
  off: ['iMessage is off here', '#bff4ff'],
  none: ['No phone linked', '#bff4ff'],
};

function text(g, str, x, y, { size = 28, weight = 600, color = '#ffffff', align = 'left' } = {}) {
  g.font = `${weight} ${size}px ${FONT}`;
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillText(str, x, y);
}

function paragraph(g, str, x, y, maxW, { size = 26, weight = 600, color = 'rgba(255,255,255,0.88)', align = 'left', lineH = size * 1.35 } = {}) {
  g.font = `${weight} ${size}px ${FONT}`;
  const lines = wrapText(g, str, maxW);
  lines.forEach((line, i) => text(g, line, x, y + i * lineH, { size, weight, color, align }));
  return lines.length * lineH;
}

function drawField(g, rect, { value, placeholder, focused, blink }) {
  roundRect(g, rect.x, rect.y, rect.w, rect.h, 22);
  g.fillStyle = 'rgba(255,255,255,0.94)';
  g.fill();
  g.lineWidth = focused ? 5 : 3;
  g.strokeStyle = focused ? '#4fd8e8' : 'rgba(255,255,255,0.9)';
  g.stroke();
  g.save();
  roundRect(g, rect.x + 4, rect.y, rect.w - 8, rect.h, 20);
  g.clip();
  g.font = `600 32px ${FONT}`;
  const tw = g.measureText(value).width;
  // Keep the end of long input in view.
  const tx = rect.x + 26 - Math.max(0, tw - (rect.w - 60));
  text(g, value || placeholder, tx, rect.y + rect.h / 2 + 1, { size: 32, color: value ? NAVY : 'rgba(12,47,82,0.42)' });
  if (focused && blink) {
    g.fillStyle = NAVY;
    g.fillRect(tx + (value ? tw : 0) + 2, rect.y + rect.h / 2 - 20, 3, 40);
  }
  g.restore();
}

function drawChip(g, x, y, label, color) {
  g.font = `700 22px ${FONT}`;
  const w = g.measureText(label).width + 40;
  roundRect(g, x, y, w, 44, 22);
  g.fillStyle = 'rgba(0, 30, 70, 0.4)';
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = color;
  g.stroke();
  text(g, label, x + 20, y + 23, { size: 22, weight: 700, color });
}

function drawLink(g, label, x, y, hover, { align = 'left', size = 26 } = {}) {
  text(g, label, x, y, { size, weight: 700, color: hover ? '#ffffff' : '#bff4ff', align });
  g.font = `700 ${size}px ${FONT}`;
  const w = g.measureText(label).width;
  const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  g.fillStyle = hover ? '#ffffff' : 'rgba(191,244,255,0.7)';
  g.fillRect(x0, y + size * 0.62, w, 2);
  return { x: x0 - 12, y: y - size, w: w + 24, h: size * 2 };
}

export default function PhoneUI(props) {
  const ref = useRef({});
  ref.current = props;
  const st = useRef({ widgets: [], particles: [], alpha: 0, lastStatus: null, finishAt: null }).current;
  const burst = (x, y, n, spread) => {
    for (let i = 0; i < n; i++) {
      st.particles.push({
        x: x + (Math.random() - 0.5) * spread,
        y,
        r: 10 + Math.random() * 18,
        vy: -(160 + Math.random() * 140),
        age: -i * 0.05,
        life: 1.1 + Math.random() * 0.5,
      });
    }
  };

  const ui = useCanvasUI({
    priority: 2,
    design: (cssW, cssH) => ({ w: PHONE_W, h: Math.round((PHONE_W * cssH) / cssW) }),
    widgets: () => st.widgets,
    active: () => st.alpha > 0.3,
    onActivate: (wdg) => {
      const p = ref.current;
      if (wdg.id.startsWith('hype-') || wdg.id.startsWith('sticker-')) {
        const { rect } = wdg;
        burst(rect.x + rect.w / 2, rect.y + rect.h / 2, 7, rect.w * 0.8);
        p.onHype(wdg.seat, wdg.sticker);
        return;
      }
      switch (wdg.id) {
        case 'submit': p.onSubmit(); break;
        case 'cancel': p.onCancelEdit(); break;
        case 'edit': p.onEdit(); break;
        case 'optin': location.href = `sms:${p.me.line}&body=${encodeURIComponent('hi aerodance 🫧')}`; break;
        case 'wallet': window.open(p.me.wallet.explorer, '_blank', 'noopener'); break;
        case 'receipt': window.open(p.battle.receipt.explorer, '_blank', 'noopener'); break;
        case 'trophy': window.open(p.battle.trophy.explorer, '_blank', 'noopener'); break;
        case 'toast': window.open(p.toast.link, '_blank', 'noopener'); break;
        case 'install-close': p.onDismissInstall(); break;
        case 'name':
        case 'phone': p.inputs[wdg.id].current?.focus(); break;
        default:
      }
    },
    update: (dt, s) => {
      const p = ref.current;
      st.alpha = s.ease(st.alpha, p.ready ? 1 : 0, 4);
      for (const b of st.particles) {
        b.age += dt;
        if (b.age > 0) b.y += b.vy * dt;
      }
      st.particles = st.particles.filter((b) => b.age < b.life);
      const focused = p.showForm && Object.values(p.inputs).some((r) => r.current === document.activeElement);
      const b = p.battle;
      const dancing = b?.status === 'open' && b.startedAt; // the bar fills, then shimmers while scoring
      const celebrating = st.finishAt !== null && s.time - st.finishAt < CELEBRATE_S;
      if (st.particles.length || focused || p.toast || dancing || celebrating) s.invalidate();
    },
    opacity: () => st.alpha,
    draw: (g, s) => {
      const p = ref.current;
      const h = s.hover;
      const widgets = [];
      const press = (id) => s.press * (h[id] ?? 0);

      const tsize = 112;
      drawTitle(g, { x: (PHONE_W - titleWidth(g, tsize)) / 2, y: 190, size: tsize });
      drawCaps(g, 'DANCE · POP · SPLASH', PHONE_W / 2, 240, { size: 20, align: 'center' });
      let y = 288;

      // ---------- profile form ----------
      const placeInput = (key, rect) => {
        const input = p.inputs[key].current;
        if (!input) return;
        const frame = input.parentElement.getBoundingClientRect();
        const scale = frame.width / s.w;
        Object.assign(input.style, {
          display: 'block',
          left: `${rect.x * scale}px`,
          top: `${(rect.y - s.scroll) * scale}px`,
          width: `${rect.w * scale}px`,
          height: `${rect.h * scale}px`,
        });
      };
      if (p.showForm) {
        const panel = { x: M, y, w: CW };
        const inner = panel.x + PAD;
        const iw = CW - PAD * 2;
        let fy = y + 52;
        g.font = `600 24px ${FONT}`;
        const hint = wrapText(g, 'Get results, hype and rewards over iMessage. Your number is your Solana devnet wallet. No password, ever.', iw);
        const height = 52 + 46 + 92 + 70 + 92 + 24 + hint.length * 33 + 36 + 104 + (p.editing ? 96 : 40);
        drawGlassPanel(g, { ...panel, h: height }, 34);
        drawCaps(g, p.editing ? 'EDIT YOUR PROFILE' : 'DIVE IN', PHONE_W / 2, fy, { size: 26, align: 'center' });
        fy += 46;
        const blink = Math.floor(s.time * 2) % 2 === 0;
        const field = (key, label, rect, placeholder) => {
          text(g, label, inner, fy, { size: 24, weight: 700 });
          const input = p.inputs[key].current;
          drawField(g, rect, { value: input?.value ?? '', placeholder, focused: input === document.activeElement, blink });
          placeInput(key, rect);
          widgets.push({ id: key, rect });
        };
        field('name', 'Your name', { x: inner, y: fy + 26, w: iw, h: 84 }, p.suggested);
        fy += 26 + 92 + 44;
        field('phone', 'iPhone number (optional)', { x: inner, y: fy + 26, w: iw, h: 84 }, '(919) 555-0123');
        fy += 26 + 92 + 18;
        hint.forEach((line, i) => text(g, line, inner, fy + i * 33, { size: 24, color: 'rgba(255,255,255,0.85)' }));
        fy += hint.length * 33 + 20;
        const submit = { x: inner, y: fy, w: iw, h: 104 };
        g.save();
        if (p.saving) g.globalAlpha *= 0.6;
        drawPill(g, submit, {
          label: p.saving ? 'Saving…' : p.editing ? 'Save' : p.battleId ? "Let's dance" : 'Join the reef',
          icon: 'play', hover: h.submit ?? 0, press: press('submit'),
        });
        g.restore();
        widgets.push({ id: 'submit', rect: submit });
        fy += 104;
        if (p.editing) widgets.push({ id: 'cancel', rect: drawLink(g, 'Cancel', PHONE_W / 2, fy + 48, h.cancel, { align: 'center' }) });
        y += height + 28;
      } else {
        for (const key of Object.keys(p.inputs)) {
          const input = p.inputs[key].current;
          if (input) input.style.display = 'none';
        }
      }

      // ---------- battle ----------
      if (!p.showForm && p.ready && p.me) {
        const b = p.battle;
        if (p.battleId && b?.players) {
          const finished = b.status === 'finished';
          const crowd = p.role?.role === 'spectator';
          const mySeat = p.role?.role === 'dancer' ? p.role.seat : null;
          const since = b.startedAt ? Date.now() - Date.parse(b.startedAt) : null;
          const dancing = !finished && since !== null && since < FAKE_DANCE_MS;
          const winnerSeat = finished ? b.winnerSeat : null;
          const anyStickers = b.players.some((pl) => Object.values(pl.hype.stickers ?? {}).some(Boolean));
          const got = anyStickers ? 46 : 0;
          const cardH = (crowd && !finished ? 420 : 210) + got;
          const head = 128;
          const strip = !finished && since !== null ? 52 : 0;
          const height = head + strip + cardH - 20 + PAD + (finished ? 56 : 0) + (finished && b.trophy ? 52 : 0);

          // The winner's whole screen celebrates for a few seconds.
          const tWin = st.finishAt === null ? Infinity : s.time - st.finishAt;
          if (winnerSeat !== null && winnerSeat === mySeat && tWin < CELEBRATE_S) {
            const fade = 1 - clamp01((tWin - CELEBRATE_S + 1.5) / 1.5);
            drawSunburst(g, PHONE_W / 2, s.scroll + s.h * 0.42, 760 * popIn(clamp01(tWin / 0.9)), { angle: tWin * 0.3, alpha: 0.8 * fade, rays: 16 });
          }

          drawGlassPanel(g, { x: M, y, w: CW, h: height }, 34);
          // Your player number, the way a Wii remote shows it.
          drawPlayerLeds(g, PHONE_W / 2, y + 64, { player: p.role?.player, glow: dancing ? 0.5 + 0.5 * Math.sin(s.time * 6) : 0.6 });
          if (b.spectators) text(g, `👀 ${b.spectators}`, M + CW - PAD, y + 64, { size: 26, weight: 700, align: 'right' });

          let top = y + head;
          if (strip) {
            // The dance: a glossy bar filling up, then a shimmer while scores come in.
            const bar = { x: M + PAD, y: top, w: CW - PAD * 2, h: 28 };
            roundRect(g, bar.x, bar.y, bar.w, bar.h, bar.h / 2);
            g.fillStyle = 'rgba(0, 30, 70, 0.35)';
            g.fill();
            const k = clamp01(since / FAKE_DANCE_MS);
            if (k > 0) {
              roundRect(g, bar.x, bar.y, Math.max(bar.h, bar.w * k), bar.h, bar.h / 2);
              const fill = g.createLinearGradient(0, bar.y, 0, bar.y + bar.h);
              fill.addColorStop(0, '#b9fff0');
              fill.addColorStop(1, '#2fc7d8');
              g.fillStyle = fill;
              g.fill();
            }
            if (k >= 1) {
              const sx = bar.x + ((s.time * 0.8) % 1) * bar.w;
              g.save();
              roundRect(g, bar.x, bar.y, bar.w, bar.h, bar.h / 2);
              g.clip();
              const shine = g.createLinearGradient(sx - 80, 0, sx + 80, 0);
              shine.addColorStop(0, 'rgba(255,255,255,0)');
              shine.addColorStop(0.5, 'rgba(255,255,255,0.8)');
              shine.addColorStop(1, 'rgba(255,255,255,0)');
              g.fillStyle = shine;
              g.fillRect(bar.x, bar.y, bar.w, bar.h);
              g.restore();
            }
            top += strip;
          }

          const cols = Math.min(b.players.length, 2);
          const gap = 18;
          const cw = (CW - PAD * 2 - gap * (cols - 1)) / cols;
          b.players.slice(0, 2).forEach((pl, i) => {
            const cx = M + PAD + i * (cw + gap);
            const bob = dancing && pl.name ? Math.sin(s.time * 9 + i * Math.PI) * 7 : 0;
            const card = { x: cx, y: top + bob, w: cw, h: cardH - 20 };
            const won = winnerSeat !== null && pl.seat === winnerSeat;
            const lost = winnerSeat !== null && !won;
            if (won) drawSunburst(g, cx + cw / 2, card.y + 90, 230, { angle: s.time * 0.3, alpha: 0.7 });
            g.save();
            if (lost) g.globalAlpha *= 0.55;
            roundRect(g, card.x, card.y, card.w, card.h, 26);
            g.fillStyle = won ? 'rgba(255,240,180,0.22)' : 'rgba(255,255,255,0.14)';
            g.fill();
            const mine = pl.seat === mySeat;
            g.lineWidth = won ? 5 : mine ? 4 : 2;
            g.strokeStyle = won ? '#ffd34d' : mine ? '#7affdc' : 'rgba(255,255,255,0.5)';
            g.stroke();
            const ty = card.y;
            if (pl.name) {
              g.font = `800 30px ${FONT}`;
              text(g, ellipsize(g, pl.name, cw - 24), cx + cw / 2, ty + 40, { size: 30, weight: 800, align: 'center' });
            } else {
              // An open seat: an empty bubble waiting for someone.
              drawBubble(g, cx + cw / 2, ty + 44, 24 + Math.sin(s.time * 3) * 3, 0.9);
            }
            text(g, pl.result ? String(pl.result.score) : '–', cx + cw / 2, ty + 98, { size: 54, weight: 800, align: 'center', color: won ? '#ffe27a' : '#ffffff' });
            text(g, `🫧 ${pl.hype.count} · ${fmtSol(pl.hype.sol)}`, cx + cw / 2, ty + 154, { size: 22, align: 'center', color: 'rgba(255,255,255,0.8)' });
            // Stickers this dancer got: icon ×n.
            const received = STICKERS.filter((st2) => pl.hype.stickers?.[st2.id]);
            received.forEach((st2, k) => {
              const sx = cx + cw / 2 + (k - (received.length - 1) / 2) * 80;
              drawSticker(g, st2.id, sx - 14, ty + 194, 36, () => s.invalidate());
              text(g, `×${pl.hype.stickers[st2.id]}`, sx + 8, ty + 195, { size: 22, weight: 700 });
            });
            g.restore();
            if (won) {
              const tm = st.finishAt === null ? 1 : clamp01((s.time - st.finishAt - 0.3) / 0.5);
              drawMedal(g, card.x + card.w - 22, card.y + 18, 30 * popIn(tm));
              for (let k = 0; k < 4; k++) {
                const tw = 0.5 + 0.5 * Math.sin(s.time * 3 + k * 1.7);
                drawSparkle(g, card.x + [16, card.w - 10, 24, card.w - 30][k], card.y + [30, card.h - 20, card.h - 40, 70][k], 12 * tw, tw);
              }
            }
            if (crowd && !finished) {
              const id = `hype-${pl.seat}`;
              const btn = { x: cx + 14, y: top + 186 + got, w: cw - 28, h: 80 };
              const enabled = !!pl.name && !p.hyping;
              g.save();
              if (!enabled) g.globalAlpha *= 0.5;
              drawPill(g, btn, { label: 'Hype', icon: 'bubble', hover: enabled ? (h[id] ?? 0) : 0, press: enabled ? press(id) : 0 });
              g.restore();
              if (enabled) widgets.push({ id, seat: pl.seat, rect: btn });
              // Or send a sticker NFT.
              const size = Math.min(76, (cw - 28 - 16) / 3);
              STICKERS.forEach((st2, k) => {
                const sid = `sticker-${pl.seat}-${st2.id}`;
                const cxk = cx + cw / 2 + (k - 1) * (size + 8);
                const cy = top + 186 + got + 80 + 22 + size / 2;
                const grow = enabled ? (h[sid] ?? 0) * 6 - press(sid) * 6 : 0;
                g.save();
                if (!enabled) g.globalAlpha *= 0.5;
                drawSticker(g, st2.id, cxk, cy, size + grow, () => s.invalidate());
                g.restore();
                if (enabled) widgets.push({ id: sid, seat: pl.seat, sticker: st2.id, rect: { x: cxk - size / 2, y: cy - size / 2, w: size, h: size } });
              });
            }
            // The moment it's decided: bubbles burst out of the winner's card.
            if (won && st.lastStatus === 'open') burst(cx + cw / 2, card.y + card.h / 2, 16, cw);
          });
          if (finished && st.lastStatus === 'open') st.finishAt = s.time;
          st.lastStatus = b.status;
          if (finished) {
            const ry = top + cardH + 12;
            if (b.receipt?.explorer) widgets.push({ id: 'receipt', rect: drawLink(g, 'On-chain receipt ↗', PHONE_W / 2, ry, h.receipt, { align: 'center' }) });
            else text(g, 'On-chain receipt pending…', PHONE_W / 2, ry, { size: 26, align: 'center', color: 'rgba(255,255,255,0.85)' });
            if (b.trophy) {
              const mineTrophy = mySeat !== null && mySeat === b.winnerSeat;
              if (b.trophy.explorer) {
                const label = mineTrophy ? 'Your trophy NFT ↗' : "Winner's trophy NFT ↗";
                widgets.push({ id: 'trophy', rect: drawLink(g, label, PHONE_W / 2, ry + 52, h.trophy, { align: 'center' }) });
              } else {
                text(g, 'Minting the trophy NFT…', PHONE_W / 2, ry + 52, { size: 26, align: 'center', color: 'rgba(255,255,255,0.85)' });
              }
            }
          }
          y += height + 28;
        } else if (!p.battleId) {
          const msg = 'Scan the QR code on the aerodance screen to dance or cheer. You can also text "battle" to the aerodance bot.';
          g.font = `600 26px ${FONT}`;
          const lines = wrapText(g, msg, CW - PAD * 2);
          const height = 96 + lines.length * 35 + PAD;
          drawGlassPanel(g, { x: M, y, w: CW, h: height }, 34);
          drawCaps(g, 'FIND A BATTLE', PHONE_W / 2, y + 52, { size: 26, align: 'center' });
          paragraph(g, msg, M + PAD, y + 104, CW - PAD * 2, { lineH: 35 });
          y += height + 28;
        }

        // ---------- me ----------
        const me = p.me;
        const optin = me.imessage === 'optin';
        const meH = 170 + (optin ? (me.line ? 190 : 60) : 0) + 220 + 60;
        drawGlassPanel(g, { x: M, y, w: CW, h: meH }, 34);
        g.font = `800 38px ${FONT}`;
        text(g, ellipsize(g, me.name, CW - PAD * 2 - 110), M + PAD, y + 60, { size: 38, weight: 800 });
        widgets.push({ id: 'edit', rect: drawLink(g, 'Edit', M + CW - PAD, y + 60, h.edit, { align: 'right' }) });
        const [chipLabel, chipColor] = IMESSAGE[me.imessage] ?? IMESSAGE.pending;
        drawChip(g, M + PAD, y + 98, chipLabel, chipColor);
        let my = y + 170;
        if (optin) {
          if (me.line) {
            const btn = { x: M + PAD, y: my, w: CW - PAD * 2, h: 96 };
            drawPill(g, btn, { label: 'Text the bot', sub: 'to finish linking', icon: 'bubble', hover: h.optin ?? 0, press: press('optin') });
            widgets.push({ id: 'optin', rect: btn });
            paragraph(g, 'One tap opens Messages with a hi ready to send.', M + PAD, my + 132, CW - PAD * 2, { size: 23 });
            my += 190;
          } else {
            text(g, "Finding your bot's number…", M + PAD, my + 20, { size: 24, color: 'rgba(255,255,255,0.85)' });
            my += 60;
          }
        }
        const stats = [
          [me.stats.battles, 'battles'],
          [me.stats.wins, 'wins'],
          [me.stats.bestScore, 'best score'],
          [me.stats.pops, 'bubbles popped'],
          [me.stats.hypeCount, 'hype received'],
          [me.wallet?.balance != null ? me.wallet.balance.toFixed(3) : '–', 'devnet SOL'],
        ];
        const colW = (CW - PAD * 2) / 3;
        stats.forEach(([value, label], i) => {
          const cx = M + PAD + (i % 3) * colW + colW / 2;
          const cy = my + Math.floor(i / 3) * 106;
          text(g, String(value), cx, cy + 34, { size: 42, weight: 800, align: 'center' });
          text(g, label, cx, cy + 76, { size: 21, weight: 700, align: 'center', color: 'rgba(255,255,255,0.75)' });
        });
        my += 220;
        if (me.wallet) {
          text(g, 'Wallet', M + PAD, my + 22, { size: 24, color: 'rgba(255,255,255,0.8)' });
          widgets.push({ id: 'wallet', rect: drawLink(g, `${shortAddr(me.wallet.address)} ↗`, M + PAD + 92, my + 22, h.wallet, { size: 24 }) });
        } else {
          text(g, 'Setting up your devnet wallet…', M + PAD, my + 22, { size: 24, color: 'rgba(255,255,255,0.8)' });
        }
        y += meH + 28;

        // ---------- Add to Home Screen ----------
        if (p.showInstall) {
          const msg = 'Tap Share, then Add to Home Screen. It opens full screen, and your stats come with you.';
          g.font = `600 24px ${FONT}`;
          const lines = wrapText(g, msg, CW - PAD * 2);
          const height = 92 + lines.length * 32 + 24;
          drawGlassPanel(g, { x: M, y, w: CW, h: height }, 30);
          text(g, 'Keep aerodance on your Home Screen', M + PAD, y + 48, { size: 26, weight: 800 });
          const close = { x: M + CW - 70, y: y + 18, w: 56, h: 56 };
          text(g, '✕', close.x + 28, close.y + 28, { size: 28, weight: 700, align: 'center', color: h['install-close'] ? '#ffffff' : '#bff4ff' });
          widgets.push({ id: 'install-close', rect: close });
          paragraph(g, msg, M + PAD, y + 96, CW - PAD * 2, { size: 24, lineH: 32 });
          y += height + 28;
        }
      }
      s.contentHeight = y + 40;

      for (const b of st.particles) {
        if (b.age < 0) continue;
        const fade = Math.min(1, b.age * 6) * Math.min(1, (b.life - b.age) * 3);
        drawBubble(g, b.x, b.y, b.r, fade);
      }

      // ---------- toast (fixed to the screen) ----------
      if (p.toast) {
        g.font = `700 26px ${FONT}`;
        const lines = wrapText(g, p.toast.text + (p.toast.link ? ' · View ↗' : ''), CW - 80);
        const th = 40 + lines.length * 34;
        const rect = { x: M, y: s.scroll + s.h - th - 70, w: CW, h: th };
        drawGlassPanel(g, rect, 28);
        lines.forEach((line, i) => text(g, line, PHONE_W / 2, rect.y + 37 + i * 34, { size: 26, weight: 700, align: 'center' }));
        if (p.toast.link) widgets.push({ id: 'toast', rect });
      }
      st.widgets = widgets;
    },
  });

  // The phone view redraws when its React state changes.
  ui.invalidate();
  return null;
}
