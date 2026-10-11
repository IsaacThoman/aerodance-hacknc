import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import {
  FONT, drawCaps, drawGlassCircle, drawGlassPanel, drawHeader, drawPill, drawPlayerLeds, drawProgress, drawShadowText, ellipsize, ICONS,
} from '../ui/draw.js';
import useCanvasUI from '../ui/useCanvasUI.js';
import { playUISound } from '../audio/uiSounds.js';
import { COUNTDOWN_MS, READY_HOLD_MS } from './GameSession.js';
import { PLAYERS, REVEAL, backOut, clamp01, timeline } from './results.js';
import {
  GAME_PAUSE, GAME_PAUSE_PANEL, GAME_PROGRESS, GAME_QUIT, GAME_READY_BACK, GAME_READY_START, GAME_RESTART, GAME_RESUME,
  LIVE_PANEL, RESULTS_CONTINUE, RESULTS_RETRY, RESULTS_SONGS, livePanelCenterX,
} from './layout.js';

/**
 * The gameplay overlay, drawn in-engine over the song's stage (StageView draws the dancers
 * and the players' live characters):
 *
 *   ready      "step into your spot": each player's tracking, then the countdown starts
 *              itself once everyone has been tracked for a second (or Start now)
 *   countdown  3, 2, 1 from the song's scheduled start
 *   playing    each player's score, combo and judgements under their live character, the
 *              song's progress, and a pause button (Escape, the remote's B, a hidden tab)
 *   paused     Resume (with a fresh countdown), Restart, Song select
 *   results    the winner (or the solo score), grades and judgements, a new best, then
 *              Play again / Song select (or Continue, back to a battle)
 *
 * The canvas reports data-game-phase, -game-countdown, -game-time-ms and -game-scores for tests.
 *
 * <GameScreen visible session={GameSession} results={ref} battle onQuit onRetry onContinue />
 */

const JUDGEMENT_LOOK = {
  perfect: ['PERFECT!', ['#fff6cc', '#ffd34d', '#f0a500']],
  good: ['GOOD', ['#ffffff', '#b9fff0', '#2fc7d8']],
  ok: ['OK', ['#ffffff', '#e6f8ff', '#8fc8e8']],
  miss: ['MISS', ['#ffffff', '#ffd2c8', '#ff8a7a']],
  lost: ['LOST TRACKING', ['#ffffff', '#e2e9f2', '#9fb3c8']],
};
const POPUP_S = 0.9;
const GOLD = ['#fff6cc', '#ffd34d', '#f0a500'];
const READINESS = {
  missing: ['Step into view', '#ffffff'],
  calibrating: ['Hold still…', '#bff4ff'],
  ready: ['Ready!', '#9effdf'],
};

const fmt = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const pct = (x) => `${Math.round(x * 100)}%`;

/** Headline in the wordmark's treatment: dark halo, hard drop shadow, glossy tinted face. */
function headline(g, str, x, y, size, face, maxW) {
  g.save();
  if ('letterSpacing' in g) g.letterSpacing = `${-size * 0.015}px`;
  g.font = `800 ${size}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.shadowColor = 'rgba(0, 28, 70, 0.55)';
  g.shadowBlur = 46;
  g.shadowOffsetY = 10;
  g.fillStyle = 'rgba(0, 40, 90, 0.35)';
  g.fillText(str, x, y, maxW);
  g.shadowColor = 'rgba(0, 34, 84, 0.75)';
  g.shadowBlur = 4;
  g.shadowOffsetY = size * 0.09;
  g.fillStyle = '#ffffff';
  g.fillText(str, x, y, maxW);
  g.shadowColor = 'transparent';
  const grad = g.createLinearGradient(0, y - size * 0.75, 0, y);
  grad.addColorStop(0, face[0]);
  grad.addColorStop(0.5, face[1]);
  grad.addColorStop(1, face[2]);
  g.fillStyle = grad;
  g.fillText(str, x, y, maxW);
  g.restore();
}

function drawPlayerHud(g, id, result, readiness, popups, now) {
  const cx = livePanelCenterX(id) * 1600;
  const top = (LIVE_PANEL.top + LIVE_PANEL.height) * 900 + 14;
  const p = PLAYERS[id];
  drawPlayerLeds(g, cx - 92, top + 18, { player: id + 1, glow: readiness === 'missing' ? 0.3 : 1, scale: 0.36 });
  drawCaps(g, `PLAYER ${id + 1}`, cx - 58, top + 19, { size: 18 });
  headline(g, (result?.score ?? 0).toLocaleString('en-US'), cx, top + 76, 46, ['#ffffff', p.light, p.color], 300);
  if (result?.combo > 1) drawShadowText(g, `${result.combo} combo`, cx, top + 108, { size: 22, weight: 800, align: 'center', color: '#bff4ff' });
  if (readiness === 'missing') drawShadowText(g, 'Step back into view', cx, top + 138, { size: 20, weight: 700, align: 'center', color: '#ffe27a' });
  // The newest judgement pops in over the character's feet and floats up.
  const pop = popups.filter((j) => j.playerId === id).at(-1);
  if (pop) {
    const age = now - pop.at;
    if (age < POPUP_S) {
      const [label, face] = JUDGEMENT_LOOK[pop.judgement];
      g.save();
      g.globalAlpha *= 1 - clamp01((age - POPUP_S * 0.6) / (POPUP_S * 0.4));
      const s = backOut(clamp01(age / 0.22));
      g.translate(cx, top - 24 - age * 30);
      g.scale(s, s);
      headline(g, label, 0, 0, pop.judgement === 'lost' ? 26 : 38, face, 320);
      g.restore();
    }
  }
}

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
    else { const p = PLAYERS[winner]; title = `${p.name.toUpperCase()} WINS!`; face = ['#ffffff', p.light, p.color]; }
  }
  g.save();
  g.translate(800, 116);
  g.scale(pop, pop);
  headline(g, title, 0, 0, t < REVEAL && !solo ? 70 : 96, face, 1200);
  g.restore();
  g.font = `600 24px ${FONT}`;
  drawShadowText(g, ellipsize(g, `${song.title} · ${song.artist}`, 1100), 800, 172, { size: 24, weight: 600, align: 'center' });

  const xs = solo ? [800] : [500, 1100];
  results.forEach((r, i) => {
    const x = xs[i];
    const p = PLAYERS[i];
    const win = !solo && winner === i;
    const lose = !solo && winner !== null && !win;
    g.save();
    g.globalAlpha *= lose ? 1 - 0.2 * reveal : 1;
    const status = solo ? 'FINAL SCORE' : winner === null && t >= REVEAL ? 'TIED' : null;
    if (status) drawCaps(g, status, x, 590, { size: 20, align: 'center' });
    drawPlayerLeds(g, x - 104, 624, { player: i + 1, glow: 1, scale: 0.36 });
    drawCaps(g, p.name.toUpperCase(), x - 52, 625, { size: 22 });
    const grow = win ? 0.12 * backOut(clamp01((t - REVEAL) / 0.32)) : 0;
    g.save();
    g.translate(x, 700);
    g.scale(1 + grow, 1 + grow);
    headline(g, Math.round(r.score * count).toLocaleString('en-US'), 0, 0, 78, win && reveal > 0 ? GOLD : ['#ffffff', p.light, p.color], 520);
    g.restore();
    // Grade, accuracy and judgements once the count finishes.
    g.globalAlpha *= clamp01((t - REVEAL + 0.2) / 0.4);
    const j = r.judgements;
    g.font = `800 24px ${FONT}`;
    drawShadowText(g, `Grade ${r.grade} · ${pct(r.accuracy)}`, x, 742, { size: 24, weight: 800, align: 'center' });
    const line = `${j.perfect} Perfect · ${j.good} Good · ${j.ok} OK · ${j.miss + j.lost} Miss · combo ${r.maxCombo}`;
    g.font = `700 19px ${FONT}`;
    drawShadowText(g, ellipsize(g, line, 560), x, 770, { size: 19, weight: 700, align: 'center', color: '#e6f8ff' });
    if (r.coverage < 0.8) drawShadowText(g, `Tracked for ${pct(r.coverage)} of the song`, x, 560, { size: 19, weight: 700, align: 'center', color: '#ffe27a' });
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

export default function GameScreen({ visible = false, blocked = false, session, results, battle = false, onQuit, onRetry, onContinue }) {
  const gl = useThree((state) => state.gl);
  const props = useRef({});
  props.current = { visible, blocked, session, results, battle, onQuit, onRetry, onContinue };
  const st = useRef({ alpha: 0, popups: [], reported: '', countdownShown: null }).current;

  const live = () => props.current.visible && !props.current.blocked && st.alpha > 0.3;
  const phase = () => props.current.session?.phase ?? 'loading';

  const ui = useCanvasUI({
    priority: 2,
    active: live,
    keyNav: () => ['ready', 'paused', 'results'].includes(phase()),
    widgets: () => {
      const ph = phase();
      if (ph === 'ready' || ph === 'loading' || ph === 'error') {
        const list = [{ id: 'quit', circle: GAME_READY_BACK, sound: 'back' }];
        if (ph === 'ready') list.push({ id: 'start', rect: GAME_READY_START });
        return list;
      }
      if (ph === 'countdown' || ph === 'playing') return [{ id: 'pause', circle: GAME_PAUSE, nav: false }];
      if (ph === 'paused') return [{ id: 'resume', rect: GAME_RESUME }, { id: 'restart', rect: GAME_RESTART }, { id: 'quit', rect: GAME_QUIT, sound: 'back' }];
      if (ph === 'results') {
        return props.current.battle ? [{ id: 'continue', rect: RESULTS_CONTINUE }] : [{ id: 'retry', rect: RESULTS_RETRY }, { id: 'quit', rect: RESULTS_SONGS }];
      }
      return [];
    },
    onActivate: (wdg, s) => {
      const p = props.current;
      const session = p.session;
      if (wdg.id === 'start') session?.start();
      else if (wdg.id === 'pause') session?.pause();
      else if (wdg.id === 'resume') session?.resume();
      else if (wdg.id === 'restart' || wdg.id === 'retry') p.onRetry?.();
      else if (wdg.id === 'quit') p.onQuit?.();
      else if (wdg.id === 'continue') p.onContinue?.();
      s.invalidate();
    },
    onKey: (e, s) => {
      if (!live() || e.repeat) return;
      const session = props.current.session;
      const ph = phase();
      if (e.key === 'Escape') {
        if (ph === 'countdown' || ph === 'playing') { playUISound('back'); session.pause(); }
        else if (ph === 'paused') { playUISound('select'); session.resume(); }
        else if (ph === 'ready' || ph === 'error') { playUISound('back'); props.current.onQuit?.(); }
        else return;
      } else return;
      e.preventDefault();
      s.invalidate();
    },
    onBack: (s) => {
      const session = props.current.session;
      const ph = phase();
      if (ph === 'countdown' || ph === 'playing') session.pause();
      else if (ph === 'paused') session.resume();
      else if (ph === 'ready' || ph === 'error') props.current.onQuit?.();
      else return false;
      s.invalidate();
      return true;
    },
    update: (dt, s) => {
      const p = props.current;
      st.alpha = s.ease(st.alpha, p.visible ? 1 : 0, p.visible ? 4 : 8);
      const session = p.session;
      if (!p.visible || !session) return;
      session.update(performance.now());
      // Animated every frame while a song is on: scores, the countdown, popups, readiness.
      s.invalidate();
      const now = s.time;
      st.popups = st.popups.filter((j) => now - j.at < POPUP_S);
      const scores = session.scorer.results().map((r) => r.score);
      const report = {
        gamePhase: session.phase,
        gameCountdown: session.phase === 'countdown' ? String(Math.ceil(session.countdownMs() / 1000)) : '',
        gameTimeMs: session.player ? String(Math.round(session.player.timeMs())) : '',
        gameScores: scores.join('|'),
      };
      const json = JSON.stringify(report);
      if (json !== st.reported) { st.reported = json; Object.assign(gl.domElement.dataset, report); }
      // A tick for each new count in the countdown.
      const n = session.phase === 'countdown' ? Math.ceil(session.countdownMs() / 1000) : null;
      if (n !== st.countdownShown) {
        st.countdownShown = n;
        if (n) playUISound('hover');
      }
    },
    opacity: () => st.alpha,
    draw: (g, s) => {
      const p = props.current;
      const session = p.session;
      const h = s.hover;
      const press = (id) => s.press * (h[id] ?? 0);
      if (!session) return;
      const { song } = session.bundle;
      const ph = session.phase;
      const now = s.time;

      if (ph === 'loading' || ph === 'error' || ph === 'ready') {
        drawHeader(g, GAME_READY_BACK, 'GET READY', h.quit ?? 0);
        g.font = `800 64px ${FONT}`;
        drawShadowText(g, ellipsize(g, song.title, 1000), 128, 270, { size: 64, weight: 800 });
        g.font = `700 30px ${FONT}`;
        drawShadowText(g, ellipsize(g, song.artist, 1000), 130, 322, { size: 30, color: '#d8f6ff' });
        if (ph === 'loading') drawShadowText(g, `Loading song${'.'.repeat(1 + (Math.floor(now * 3) % 3))}`, 800, 520, { size: 34, align: 'center' });
        if (ph === 'error') drawShadowText(g, session.error, 800, 520, { size: 30, align: 'center', color: '#ffb38a' });
        if (ph === 'ready') {
          const readiness = session.readiness();
          const panel = { x: 360, y: 400, w: 880, h: 250 };
          drawGlassPanel(g, panel, 30);
          drawCaps(g, session.playerCount === 2 ? 'STEP INTO YOUR SPOTS' : 'STEP INTO VIEW', 800, panel.y + 40, { size: 22, align: 'center' });
          const cue = session.playerCount === 2
            ? 'Player 1 on the left, player 2 on the right. Keep your whole body in the camera.'
            : 'Keep your whole body in the camera. The song starts once you are tracked.';
          drawShadowText(g, cue, 800, panel.y + 80, { size: 22, weight: 600, align: 'center', color: '#e6f8ff' });
          const xs = session.playerCount === 2 ? [600, 1000] : [800];
          readiness.forEach((r, id) => {
            const [label, color] = READINESS[r];
            drawPlayerLeds(g, xs[id], panel.y + 140, { player: id + 1, glow: r === 'ready' ? 1 : 0.35, scale: 0.42 });
            drawShadowText(g, label, xs[id], panel.y + 200, { size: 30, weight: 800, align: 'center', color });
          });
          const hold = session.readySince === null ? 0 : clamp01((performance.now() - session.readySince) / READY_HOLD_MS);
          const allReady = readiness.every((r) => r === 'ready');
          drawPill(g, GAME_READY_START, {
            label: allReady ? 'Starting…' : 'Start now', sub: allReady ? '' : 'without waiting for tracking',
            icon: 'play', hover: h.start ?? 0, press: press('start'),
          });
          if (hold > 0) drawProgress(g, { x: GAME_READY_START.x + 40, y: GAME_READY_START.y + GAME_READY_START.h + 18, w: GAME_READY_START.w - 80, h: 12 }, hold);
        }
        return;
      }

      if (ph === 'results') {
        const show = p.results?.current;
        if (show) drawResults(g, show, performance.now() / 1000, song, p.battle);
        if (p.battle) drawPill(g, RESULTS_CONTINUE, { label: 'Continue', icon: 'right', hover: h.continue ?? 0, press: press('continue') });
        else {
          drawPill(g, RESULTS_RETRY, { label: 'Play again', icon: 'replay', hover: h.retry ?? 0, press: press('retry') });
          drawPill(g, RESULTS_SONGS, { label: 'Song select', icon: 'list', hover: h.quit ?? 0, press: press('quit') });
        }
        return;
      }

      // During the song: the players' scores, judgements and the song's progress.
      const scores = session.scorer.results();
      const readiness = session.readiness();
      for (let id = 0; id < session.playerCount; id++) drawPlayerHud(g, id, scores[id], readiness[id], st.popups, now);
      if (ph !== 'paused') {
        drawGlassCircle(g, GAME_PAUSE, h.pause ?? 0);
        g.save();
        g.fillStyle = g.strokeStyle = '#ffffff';
        g.lineWidth = 4;
        g.lineCap = 'round';
        ICONS.pause(g, GAME_PAUSE.x, GAME_PAUSE.y, GAME_PAUSE.r * 1.4);
        g.restore();
      }
      const t = session.player.timeMs() - song.playableStartMs;
      const total = song.playableEndMs - song.playableStartMs;
      drawProgress(g, GAME_PROGRESS, t / total);
      g.font = `700 22px ${FONT}`;
      drawShadowText(g, ellipsize(g, song.title, 420), GAME_PROGRESS.x, GAME_PROGRESS.y - 22, { size: 22 });
      drawShadowText(g, `${fmt(t)} / ${fmt(total)}`, GAME_PROGRESS.x + GAME_PROGRESS.w, GAME_PROGRESS.y - 22, { size: 22, align: 'right' });

      if (ph === 'countdown') {
        const left = session.countdownMs();
        const n = Math.ceil(left / 1000);
        if (n > 0 && n <= COUNTDOWN_MS / 1000) {
          const into = 1 - (left / 1000 - (n - 1));
          g.save();
          g.translate(800, 470);
          const k = backOut(clamp01(into / 0.3));
          g.scale(k, k);
          g.globalAlpha *= 1 - clamp01((into - 0.75) / 0.25);
          headline(g, String(n), 0, 70, 220, ['#ffffff', '#7fd0ff', '#0a7fd8'], 400);
          g.restore();
        }
        if (session.pausedAtMs !== undefined && session.pausedAtMs !== null) {
          drawShadowText(g, 'Get ready to pick up where you left off', 800, 620, { size: 26, weight: 700, align: 'center' });
        }
      } else if (ph === 'finishing') {
        drawShadowText(g, 'Tallying the bubbles…', 800, 470, { size: 40, weight: 800, align: 'center' });
      } else if (ph === 'paused') {
        g.save();
        g.fillStyle = 'rgba(0, 24, 60, 0.35)';
        g.fillRect(0, 0, 1600, 900);
        g.restore();
        drawGlassPanel(g, GAME_PAUSE_PANEL, 34);
        drawCaps(g, 'PAUSED', 800, GAME_PAUSE_PANEL.y + 46, { size: 30, align: 'center' });
        drawPill(g, GAME_RESUME, { label: 'Resume', icon: 'play', hover: h.resume ?? 0, press: press('resume') });
        drawPill(g, GAME_RESTART, { label: 'Restart', icon: 'replay', hover: h.restart ?? 0, press: press('restart') });
        drawPill(g, GAME_QUIT, { label: 'Song select', icon: 'list', hover: h.quit ?? 0, press: press('quit') });
      }
    },
  });

  // Judgements pop up under the players' characters.
  useEffect(() => {
    if (!session) return undefined;
    st.popups = [];
    return session.onJudgement((e) => { st.popups.push({ ...e, at: ui.time }); ui.invalidate(); });
  }, [session, st, ui]);

  // A hidden tab pauses the song (audio and scoring stop together).
  useEffect(() => {
    const onVisibility = () => { if (document.hidden) props.current.session?.pause(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (!visible) {
      for (const key of ['gamePhase', 'gameCountdown', 'gameTimeMs', 'gameScores']) delete gl.domElement.dataset[key];
      st.reported = '';
    }
    ui.invalidate();
  }, [visible, gl, st, ui]);

  return null;
}
