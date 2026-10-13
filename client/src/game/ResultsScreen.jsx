import { useRef } from 'react';
import { useThree } from '@react-three/fiber';
import {
  FONT, drawCaps, drawHeadline as headline, drawPill, drawShadowText, ellipsize,
} from '../ui/draw.js';
import useCanvasUI from '../ui/useCanvasUI.js';
import { PLAYERS, REVEAL, backOut, clamp01, timeline } from './results.js';
import { RESULTS_RETRY, RESULTS_SONGS } from './layout.js';

const GOLD = ['#fff6cc', '#ffd34d', '#f0a500'];
const pct = (x) => `${Math.round(x * 100)}%`;

function drawResults(g, show, now, song) {
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
    // One score centred, or two side by side.
    const x = solo ? 800 : 500 + i * 600;
    const p = PLAYERS[i % PLAYERS.length];
    const win = !solo && winner === i;
    const lose = !solo && winner !== null && !win;
    g.save();
    g.globalAlpha *= lose ? 1 - 0.2 * reveal : 1;
    const status = solo ? 'FINAL SCORE' : winner === null && t >= REVEAL ? 'TIED' : null;
    if (status) drawCaps(g, status, x, 590, { size: 20, align: 'center' });
    g.font = `800 22px ${FONT}`;
    drawCaps(g, ellipsize(g, r.name.toUpperCase(), 350), x, 625, { size: 22, align: 'center' });
    const grow = win ? 0.12 * backOut(clamp01((t - REVEAL) / 0.32)) : 0;
    g.save();
    g.translate(x, 700);
    g.scale(1 + grow, 1 + grow);
    headline(g, Math.round(r.score * count).toLocaleString('en-US'), 0, 0, 78, win && reveal > 0 ? GOLD : ['#ffffff', p.light, p.color], 520);
    g.restore();
    // Grade, accuracy and judgements once the count finishes.
    g.globalAlpha *= clamp01((t - REVEAL + 0.2) / 0.4);
    const j = r.judgements;
    drawShadowText(g, `Grade ${r.grade} · ${pct(r.accuracy)}`, x, 742, { size: 24, weight: 800, align: 'center' });
    const line = `${j.perfect} Perfect · ${j.good} Good · ${j.ok} OK · ${j.miss + j.lost} Miss · combo ${r.maxCombo}`;
    g.font = `700 19px ${FONT}`;
    drawShadowText(g, ellipsize(g, line, 560), x, 770, { size: 19, weight: 700, align: 'center', color: '#e6f8ff' });
    if (r.coverage < 0.8) drawShadowText(g, `Tracked for ${pct(r.coverage)} of the song`, x, 560, { size: 19, weight: 700, align: 'center', color: '#ffe27a' });
    g.restore();
  });
  if (show.best?.isNewBest) {
    g.save();
    g.globalAlpha *= clamp01((t - REVEAL - 0.3) / 0.4);
    headline(g, 'NEW BEST!', 800, 232, 40, GOLD, 600);
    g.restore();
  } else if (show.best?.best) {
    drawShadowText(g, `Best ${show.best.best.score.toLocaleString('en-US')} (${show.best.best.grade})`, 800, 222, { size: 22, weight: 700, align: 'center', color: '#bff4ff' });
  }
}

/** The song's stage celebration: the winner (or the solo score), grades and a new best. */
export default function ResultsScreen({ visible = false, blocked = false, show, song, onRetry, onQuit }) {
  const gl = useThree((state) => state.gl);
  const props = useRef({});
  props.current = { visible, blocked, show, song, onRetry, onQuit };
  const st = useRef({ alpha: 0 }).current;
  const live = () => props.current.visible && !props.current.blocked && !!props.current.show?.current;

  useCanvasUI({
    priority: 2.5,
    active: live,
    keyNav: true,
    widgets: () => [{ id: 'retry', rect: RESULTS_RETRY }, { id: 'quit', rect: RESULTS_SONGS }],
    onActivate: ({ id }) => {
      const p = props.current;
      if (id === 'retry') p.onRetry?.();
      else if (id === 'quit') p.onQuit?.();
    },
    onKey: (e) => {
      if (!live() || e.repeat || e.key !== 'Escape') return;
      props.current.onQuit?.();
      e.preventDefault();
    },
    update: (_, s) => {
      const p = props.current;
      // Gameplay already showed an opaque overlay: results and their controls must be
      // ready together, including a Play again click on the very first results frame.
      st.alpha = p.visible ? 1 : s.ease(st.alpha, 0, 8);
      if (p.visible) s.invalidate(); // reveal and score count
      if (p.visible && p.show?.current) {
        Object.assign(gl.domElement.dataset, {
          resultsScreen: 'stage',
          resultsWinner: String(p.show.current.winner),
        });
      } else {
        for (const key of ['resultsScreen', 'resultsWinner']) delete gl.domElement.dataset[key];
      }
    },
    opacity: () => st.alpha,
    draw: (g, s) => {
      const p = props.current;
      if (!p.show?.current || !p.song) return;
      drawResults(g, p.show.current, performance.now() / 1000, p.song);
      const button = (id, rect, label, icon) => drawPill(g, rect, {
        label, icon, hover: s.hover[id] ?? 0, press: s.press * (s.hover[id] ?? 0),
      });
      button('retry', RESULTS_RETRY, 'Play again', 'replay');
      button('quit', RESULTS_SONGS, 'Song select', 'list');
    },
  });
  return null;
}
