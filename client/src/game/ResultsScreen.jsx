import { useRef } from 'react';
import { useThree } from '@react-three/fiber';
import {
  FONT, drawCaps, drawGlassPanel, drawHeadline as headline, drawPill, drawPlayerLeds, drawShadowText, ellipsize,
} from '../ui/draw.js';
import useCanvasUI from '../ui/useCanvasUI.js';
import { PLAYERS, REVEAL, backOut, clamp01, timeline } from './results.js';
import { RESULTS_CONTINUE, RESULTS_RETRY, RESULTS_SONGS, RESULTS_RECEIPT, RESULTS_TROPHY, RESULTS_REMATCH, resultLayout } from './layout.js';

const GOLD = ['#fff6cc', '#ffd34d', '#f0a500'];
const pct = (x) => `${Math.round(x * 100)}%`;
const short = (id) => `${id.slice(0, 4)}…${id.slice(-4)}`;

function drawResults(g, show, now, song, battle) {
  const { results, winner } = show;
  const { t, count, reveal } = timeline(show, now);
  const solo = results.length === 1;
  let title;
  let face = ['#ffffff', '#ffffff', '#d5f3ff'];
  let pop = 1;
  if (solo) title = 'SONG COMPLETE!';
  else if (t < REVEAL) title = 'And the winner is…';
  else {
    pop = backOut(clamp01((t - REVEAL) / 0.32));
    if (winner === null) { title = "IT'S A TIE!"; face = GOLD; }
    else { const p = PLAYERS[winner % PLAYERS.length]; title = `${results[winner].name.toUpperCase()} WINS!`; face = ['#ffffff', p.light, p.color]; }
  }
  g.save();
  g.translate(800, 116);
  g.scale(pop, pop);
  headline(g, title, 0, 0, t < REVEAL && !solo ? 70 : 96, face, 1200);
  g.restore();
  g.font = `600 24px ${FONT}`;
  drawShadowText(g, ellipsize(g, [song.title, song.artist].filter(Boolean).join(' · '), 1100), 800, 172, { size: 24, weight: 600, align: 'center' });

  results.forEach((r, i) => {
    const { x, y, scale } = resultLayout(i, results.length);
    const p = PLAYERS[i % PLAYERS.length];
    const win = !solo && winner === i;
    const lose = !solo && winner !== null && !win;
    g.save();
    g.translate(x, y);
    g.scale(scale, scale);
    g.translate(-x, -590);
    g.globalAlpha *= lose ? 1 - 0.2 * reveal : 1;
    const status = solo ? 'FINAL SCORE' : winner === null && t >= REVEAL ? 'TIED' : null;
    if (status) drawCaps(g, status, x, 590, { size: 20, align: 'center' });
    drawPlayerLeds(g, x - 104, 624, { player: i + 1, glow: 1, scale: 0.36 });
    g.font = `800 22px ${FONT}`;
    drawCaps(g, ellipsize(g, r.name.toUpperCase(), 350), x - 52, 625, { size: 22 });
    const grow = win ? 0.12 * backOut(clamp01((t - REVEAL) / 0.32)) : 0;
    g.save();
    g.translate(x, 700);
    g.scale(1 + grow, 1 + grow);
    headline(g, Math.round(r.score * count).toLocaleString('en-US'), 0, 0, 78, win && reveal > 0 ? GOLD : ['#ffffff', p.light, p.color], 520);
    g.restore();
    // Grade, accuracy and judgements once the count finishes.
    g.globalAlpha *= clamp01((t - REVEAL + 0.2) / 0.4);
    if (r.judgements) {
      const j = r.judgements;
      drawShadowText(g, `Grade ${r.grade} · ${pct(r.accuracy)}`, x, 742, { size: 24, weight: 800, align: 'center' });
      const line = `${j.perfect} Perfect · ${j.good} Good · ${j.ok} OK · ${j.miss + j.lost} Miss · combo ${r.maxCombo}`;
      g.font = `700 19px ${FONT}`;
      drawShadowText(g, ellipsize(g, line, 560), x, 770, { size: 19, weight: 700, align: 'center', color: '#e6f8ff' });
      if (r.coverage < 0.8) drawShadowText(g, `Tracked for ${pct(r.coverage)} of the song`, x, 560, { size: 19, weight: 700, align: 'center', color: '#ffe27a' });
    } else {
      // Public battle links have summary scores, not the full song's grading data.
      const line = r.summary ? `${r.summary.pops} Perfect · sync ${r.summary.sync.toFixed(2)} · combo ${r.summary.flair}` : 'No score reported';
      drawShadowText(g, line, x, 742, { size: 22, weight: 700, align: 'center', color: '#e6f8ff' });
    }
    g.restore();
  });
  if (show.best?.isNewBest && !battle) {
    g.save();
    g.globalAlpha *= clamp01((t - REVEAL - 0.3) / 0.4);
    headline(g, 'NEW BEST!', 800, 232, 40, GOLD, 600);
    g.restore();
  } else if (show.best?.best && !battle) {
    drawShadowText(g, `Best ${show.best.best.score.toLocaleString('en-US')} (${show.best.best.grade})`, 800, 222, { size: 22, weight: 700, align: 'center', color: '#bff4ff' });
  }
}

function drawBattleDetails(g, s, battle) {
  const dots = '.'.repeat(1 + Math.floor(s.time * 3) % 3);
  const chip = (id, rect, label, link) => {
    drawGlassPanel(g, rect, rect.h / 2);
    drawShadowText(g, label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 1, {
      size: 22, weight: 700, align: 'center', color: link ? '#bff4ff' : '#ffffff',
      alpha: 0.85 + (s.hover[id] ?? 0) * 0.15,
    });
  };
  const receipt = battle?.receipt;
  chip('receipt', RESULTS_RECEIPT, receipt?.status === 'confirmed'
    ? `Solana receipt ${short(receipt.signature)}  ↗`
    : battle?.status === 'finished' ? `Writing the Solana receipt${dots}` : `Settling battle${dots}`, receipt?.explorer);
  const trophy = battle?.trophy;
  if (trophy) chip('trophy', RESULTS_TROPHY, trophy.status === 'minted'
    ? `Winner's trophy NFT ${short(trophy.asset)}  ↗` : `Minting the winner's trophy NFT${dots}`, trophy.explorer);
  const players = battle?.players ?? [];
  players.forEach((p, i) => {
    const { x, hypeY, scale } = resultLayout(i, players.length);
    drawShadowText(g, `${p.hype.count} hype · ${Number(p.hype.sol.toFixed(3))} SOL`, x, hypeY, {
      size: scale < 1 ? 16 : 20, weight: 700, align: 'center', color: '#bff4ff',
    });
  });
}

/** The same stage celebration for ordinary songs, QR battles and finished battle links. */
export default function ResultsScreen({ visible = false, blocked = false, show, song, battleMode = false, battle, onRetry, onQuit, onContinue, onRematch }) {
  const gl = useThree((state) => state.gl);
  const props = useRef({});
  props.current = { visible, blocked, show, song, battleMode, battle, onRetry, onQuit, onContinue, onRematch };
  const st = useRef({ alpha: 0 }).current;
  const live = () => props.current.visible && !props.current.blocked && st.alpha > 0.3;

  useCanvasUI({
    priority: 2.5,
    active: live,
    keyNav: true,
    widgets: () => {
      const p = props.current;
      if (!p.battleMode) return [{ id: 'retry', rect: RESULTS_RETRY }, { id: 'quit', rect: RESULTS_SONGS }];
      const list = [{ id: 'continue', rect: RESULTS_CONTINUE }];
      if (p.battle?.status === 'finished') list.push({ id: 'rematch', rect: RESULTS_REMATCH });
      if (p.battle?.receipt?.explorer) list.push({ id: 'receipt', rect: RESULTS_RECEIPT });
      if (p.battle?.trophy?.explorer) list.push({ id: 'trophy', rect: RESULTS_TROPHY });
      return list;
    },
    onActivate: ({ id }) => {
      const p = props.current;
      if (id === 'retry') p.onRetry?.();
      else if (id === 'quit') p.onQuit?.();
      else if (id === 'continue') p.onContinue?.();
      else if (id === 'rematch') p.onRematch?.();
      else if (id === 'receipt' || id === 'trophy') window.open(p.battle[id].explorer, '_blank', 'noopener');
    },
    onKey: (e) => {
      if (!live() || e.repeat || e.key !== 'Escape') return;
      const p = props.current;
      (p.battleMode ? p.onContinue : p.onQuit)?.();
      e.preventDefault();
    },
    onBack: () => {
      const p = props.current;
      (p.battleMode ? p.onContinue : p.onQuit)?.();
    },
    update: (_, s) => {
      const p = props.current;
      st.alpha = s.ease(st.alpha, p.visible ? 1 : 0, p.visible ? 4 : 8);
      if (p.visible) s.invalidate(); // reveal, score count, settlement and receipt updates
      if (p.visible && p.show?.current) {
        Object.assign(gl.domElement.dataset, {
          resultsScreen: 'stage',
          resultsBattle: p.battleMode ? p.battle?.id ?? '' : '',
          resultsWinner: String(p.show.current.winner),
          resultsReceipt: p.battle?.receipt?.status ?? '',
          resultsTrophy: p.battle?.trophy?.status ?? '',
        });
      } else {
        for (const key of ['resultsScreen', 'resultsBattle', 'resultsWinner', 'resultsReceipt', 'resultsTrophy']) delete gl.domElement.dataset[key];
      }
    },
    opacity: () => st.alpha,
    draw: (g, s) => {
      const p = props.current;
      if (!p.show?.current || !p.song) return;
      drawResults(g, p.show.current, performance.now() / 1000, p.song, p.battleMode);
      const button = (id, rect, label, icon) => drawPill(g, rect, {
        label, icon, hover: s.hover[id] ?? 0, press: s.press * (s.hover[id] ?? 0),
      });
      if (p.battleMode) {
        drawBattleDetails(g, s, p.battle);
        button('continue', RESULTS_CONTINUE, 'Continue', 'right');
        if (p.battle?.status === 'finished') button('rematch', RESULTS_REMATCH, 'Run it back', 'replay');
      } else {
        button('retry', RESULTS_RETRY, 'Play again', 'replay');
        button('quit', RESULTS_SONGS, 'Song select', 'list');
      }
    },
  });
  return null;
}
