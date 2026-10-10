import { useRef } from 'react';
import {
  FONT, NAVY, drawBubble, drawCaps, drawGlassPanel, drawPill, drawTitle, ellipsize, roundRect,
  titleWidth, wrapText,
} from '../ui/draw.js';
import useCanvasUI from '../ui/useCanvasUI.js';

/**
 * The phone view, drawn in-engine like the display's menus: one scrolling column laid out
 * 720 design units wide, as tall as the phone's aspect allows. Sections: the profile form,
 * the battle (your role, both dancers, Hype buttons for the crowd, the receipt), your
 * stats and wallet, and an Add to Home Screen hint.
 *
 * Text fields are real <input>s (so the phone keyboard opens) kept invisible over the
 * drawn fields; their values and focus are drawn here.
 */

export const PHONE_W = 720;
const M = 36; // side margin
const CW = PHONE_W - M * 2;
const PAD = 32; // inside panels

const fmtSol = (sol) => `${Number(sol.toFixed(3))} SOL`;
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
  const st = useRef({ widgets: [], particles: [], alpha: 0 }).current;

  const ui = useCanvasUI({
    priority: 2,
    design: (cssW, cssH) => ({ w: PHONE_W, h: Math.round((PHONE_W * cssH) / cssW) }),
    widgets: () => st.widgets,
    active: () => st.alpha > 0.3,
    onActivate: (wdg) => {
      const p = ref.current;
      if (wdg.id.startsWith('hype-')) {
        const { rect } = wdg;
        for (let i = 0; i < 7; i++) {
          st.particles.push({
            x: rect.x + rect.w / 2 + (Math.random() - 0.5) * rect.w * 0.8,
            y: rect.y + rect.h / 2,
            r: 10 + Math.random() * 18,
            vy: -(160 + Math.random() * 140),
            age: -i * 0.05,
            life: 1.1 + Math.random() * 0.5,
          });
        }
        p.onHype(wdg.seat);
        return;
      }
      switch (wdg.id) {
        case 'submit': p.onSubmit(); break;
        case 'cancel': p.onCancelEdit(); break;
        case 'edit': p.onEdit(); break;
        case 'optin': location.href = `sms:${p.me.line}&body=${encodeURIComponent('hi aerodance 🫧')}`; break;
        case 'wallet': window.open(p.me.wallet.explorer, '_blank', 'noopener'); break;
        case 'receipt': window.open(p.battle.receipt.explorer, '_blank', 'noopener'); break;
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
      if (st.particles.length || focused || p.toast) s.invalidate();
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
          const cardH = crowd && !finished ? 300 : 210;
          const height = 136 + cardH - 20 + PAD + (finished ? 56 : 0);
          drawGlassPanel(g, { x: M, y, w: CW, h: height }, 34);
          const roleLine = p.role?.role === 'dancer' ? `You're Dancer ${p.role.seat + 1}!` : crowd ? "You're in the crowd" : 'Joining…';
          text(g, roleLine, PHONE_W / 2, y + 54, { size: 40, weight: 800, align: 'center' });
          const winner = finished && b.winnerSeat !== null ? b.players[b.winnerSeat] : null;
          const status = finished
            ? winner ? `${winner.name ?? `Dancer ${b.winnerSeat + 1}`} wins!` : "It's a tie!"
            : b.players.some((pl) => pl.result) ? 'Scores coming in…'
              : p.role?.role === 'dancer' ? 'Get in front of the screen!' : `Hype the dancers with devnet SOL · ${b.spectators} watching`;
          g.font = `600 26px ${FONT}`;
          text(g, ellipsize(g, status, CW - 40), PHONE_W / 2, y + 100, { size: 26, align: 'center', color: 'rgba(255,255,255,0.9)' });

          const cols = Math.min(b.players.length, 2);
          const gap = 18;
          const cw = (CW - PAD * 2 - gap * (cols - 1)) / cols;
          const top = y + 136;
          b.players.slice(0, 2).forEach((pl, i) => {
            const cx = M + PAD + i * (cw + gap);
            const card = { x: cx, y: top, w: cw, h: cardH - 20 };
            roundRect(g, card.x, card.y, card.w, card.h, 26);
            g.fillStyle = 'rgba(255,255,255,0.14)';
            g.fill();
            g.lineWidth = pl.seat === p.role?.seat && p.role?.role === 'dancer' ? 4 : 2;
            g.strokeStyle = finished && pl.seat === b.winnerSeat ? '#ffd34d'
              : pl.seat === p.role?.seat && p.role?.role === 'dancer' ? '#7affdc' : 'rgba(255,255,255,0.5)';
            g.stroke();
            g.font = `800 30px ${FONT}`;
            const name = pl.name ? ellipsize(g, pl.name, cw - 24) : 'open seat';
            text(g, name, cx + cw / 2, top + 40, { size: 30, weight: pl.name ? 800 : 600, align: 'center', color: pl.name ? '#ffffff' : 'rgba(255,255,255,0.6)' });
            text(g, pl.result ? String(pl.result.score) : '–', cx + cw / 2, top + 98, { size: 54, weight: 800, align: 'center', color: finished && pl.seat === b.winnerSeat ? '#ffe27a' : '#ffffff' });
            text(g, `${pl.hype.count} hype · ${fmtSol(pl.hype.sol)}`, cx + cw / 2, top + 154, { size: 22, align: 'center', color: 'rgba(255,255,255,0.8)' });
            if (crowd && !finished) {
              const id = `hype-${pl.seat}`;
              const btn = { x: cx + 14, y: top + 186, w: cw - 28, h: 80 };
              const enabled = !!pl.name && !p.hyping;
              g.save();
              if (!enabled) g.globalAlpha *= 0.5;
              drawPill(g, btn, { label: 'Hype', icon: 'bubble', hover: enabled ? (h[id] ?? 0) : 0, press: enabled ? press(id) : 0 });
              g.restore();
              if (enabled) widgets.push({ id, seat: pl.seat, rect: btn });
            }
          });
          if (finished) {
            const ry = top + cardH + 12;
            if (b.receipt?.explorer) widgets.push({ id: 'receipt', rect: drawLink(g, 'On-chain receipt ↗', PHONE_W / 2, ry, h.receipt, { align: 'center' }) });
            else text(g, 'On-chain receipt pending…', PHONE_W / 2, ry, { size: 26, align: 'center', color: 'rgba(255,255,255,0.85)' });
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
