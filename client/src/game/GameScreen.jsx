import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import {
  FONT, drawCaps, drawGlassCircle, drawGlassPanel, drawHeader, drawHeadline as headline, drawPill, drawProgress, drawShadowText, ellipsize, ICONS,
} from '../ui/draw.js';
import useCanvasUI from '../ui/useCanvasUI.js';
import { COUNTDOWN_MS, READY_HOLD_MS } from './GameSession.js';
import { WEBCAM_STILL_MS } from './webcamCalibration.js';
import { drawWebcamPreview } from '../../../packages/pose/browser/preview.js';
import { PLAYERS, backOut, clamp01 } from './results.js';
import {
  GAME_CALIBRATION_PREVIEW, GAME_CALIBRATION_PROGRESS, GAME_PAUSE, GAME_PAUSE_PANEL, GAME_PROGRESS, GAME_QUIT, GAME_READY_BACK, GAME_READY_START, GAME_RESTART, GAME_RESUME,
  LIVE_PANEL, livePanelCenterX,
} from './layout.js';

/**
 * The gameplay overlay, drawn in-engine over the song's stage (StageView draws the dancers
 * and the players' live characters):
 *
 *   calibrating webcam preview: every player holds still together for 2.5 seconds
 *   ready      the countdown starts once everyone has been tracked for a second
 *              (or Start now)
 *   countdown  3, 2, 1 from the song's scheduled start
 *   playing    each player's score, combo and judgements under their live character, the
 *              song's progress, and a pause button (Escape or a hidden tab)
 *   paused     Resume (with a fresh countdown), Restart, Song select
 *   results    hands the overlay to ResultsScreen
 *
 * The canvas reports data-game-phase, -game-countdown, -game-time-ms and -game-scores for tests.
 *
 * <GameScreen visible session={GameSession} onQuit onRetry />
 */

const JUDGEMENT_LOOK = {
  perfect: ['PERFECT!', ['#fff6cc', '#ffd34d', '#f0a500']],
  good: ['GOOD', ['#ffffff', '#b9fff0', '#2fc7d8']],
  ok: ['OK', ['#ffffff', '#e6f8ff', '#8fc8e8']],
  miss: ['MISS', ['#ffffff', '#ffd2c8', '#ff8a7a']],
  lost: ['LOST TRACKING', ['#ffffff', '#e2e9f2', '#9fb3c8']],
};
const POPUP_S = 0.9;
const CALIBRATION_STATUS = {
  missing: ['Step into view', '#ffffff'],
  body: ['Keep shoulders, hips and feet in view', '#ffe27a'],
  moving: ['Movement detected — hold still', '#ffe27a'],
  holding: ['Hold still…', '#bff4ff'],
  ready: ['Calibrated!', '#9effdf'],
};

const fmt = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function drawPlayerHud(g, id, result, readiness, popups, now) {
  const cx = livePanelCenterX(id) * 1600;
  const top = (LIVE_PANEL.top + LIVE_PANEL.height) * 900 + 14;
  const p = PLAYERS[id];
  drawCaps(g, `PLAYER ${id + 1}`, cx, top + 19, { size: 18, align: 'center' });
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

export default function GameScreen({ visible = false, blocked = false, session, onQuit, onRetry }) {
  const gl = useThree((state) => state.gl);
  const props = useRef({});
  props.current = { visible, blocked, session, onQuit, onRetry };
  const st = useRef({ alpha: 0, popups: [], reported: '' }).current;

  const live = () => props.current.visible && !props.current.blocked && phase() !== 'results' && st.alpha > 0.3;
  const phase = () => props.current.session?.phase ?? 'loading';

  const ui = useCanvasUI({
    priority: 2,
    active: live,
    keyNav: () => ['loading', 'calibrating', 'ready', 'error', 'paused', 'results'].includes(phase()),
    widgets: () => {
      const ph = phase();
      if (['ready', 'calibrating', 'loading', 'error'].includes(ph)) {
        const list = [{ id: 'quit', circle: GAME_READY_BACK }];
        if (ph === 'ready' && !props.current.session.webcamCalibration) list.push({ id: 'start', rect: GAME_READY_START });
        return list;
      }
      if (ph === 'countdown' || ph === 'playing') return [{ id: 'pause', circle: GAME_PAUSE, nav: false }];
      if (ph === 'paused') return [{ id: 'resume', rect: GAME_RESUME }, { id: 'restart', rect: GAME_RESTART }, { id: 'quit', rect: GAME_QUIT }];
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
      s.invalidate();
    },
    onKey: (e, s) => {
      if (!live() || e.repeat) return;
      const session = props.current.session;
      const ph = phase();
      if (e.key === 'Escape') {
        if (ph === 'countdown' || ph === 'playing') session.pause();
        else if (ph === 'paused') session.resume();
        else if (['loading', 'calibrating', 'ready', 'error'].includes(ph)) props.current.onQuit?.();
        else return;
      } else return;
      e.preventDefault();
      s.invalidate();
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
      const calibration = ['calibrating', 'ready'].includes(session.phase) ? session.calibrationStatus() : null;
      const report = {
        gamePhase: session.phase,
        gameCountdown: session.phase === 'countdown' ? String(Math.ceil(session.countdownMs() / 1000)) : '',
        gameTimeMs: session.player ? String(Math.round(session.player.timeMs())) : '',
        gameScores: scores.join('|'),
        gameCalibrationProgress: calibration ? calibration.progress.toFixed(3) : '',
        gameCalibrationPlayers: calibration?.players.join('|') ?? '',
        gameCalibrationPreview: calibration ? String(!!session.source?.video) : '',
      };
      const json = JSON.stringify(report);
      if (json !== st.reported) { st.reported = json; Object.assign(gl.domElement.dataset, report); }
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

      if (ph === 'calibrating' || ph === 'ready' && session.webcamCalibration) {
        const calibration = session.calibrationStatus();
        const source = session.source;
        drawHeader(g, GAME_READY_BACK, 'CALIBRATION', h.quit ?? 0);
        drawShadowText(g, 'Stand still for 2.5 seconds', 800, 232, { size: 42, weight: 800, align: 'center' });
        drawShadowText(g, session.playerCount === 2 ? 'Both players: stand upright with your feet visible.' : 'Stand upright with your feet visible.', 800, 270, { size: 24, align: 'center', color: '#e6f8ff' });
        drawGlassPanel(g, { x: 348, y: 278, w: 904, h: 444 }, 24);
        drawWebcamPreview(g, source?.video, source?.view?.snapshot, GAME_CALIBRATION_PREVIEW, session.playerCount);
        // The setup preview is mirrored: player 1 is on its left-hand side.
        const xs = session.playerCount === 2 ? [580, 1020] : [800];
        calibration.players.forEach((status, id) => {
          const [label, color] = CALIBRATION_STATUS[status];
          drawCaps(g, `PLAYER ${id + 1}`, xs[id], 750, { size: 18, align: 'center' });
          drawShadowText(g, label, xs[id], 784, { size: 22, weight: 700, align: 'center', color });
        });
        drawProgress(g, GAME_CALIBRATION_PROGRESS, calibration.progress);
        const remaining = ((1 - calibration.progress) * WEBCAM_STILL_MS / 1000).toFixed(1);
        const message = source?.view?.status === 'error' ? source.view.message
          : source?.view?.status === 'disconnected' ? 'Camera disconnected. Go back to connect your webcam.'
          : calibration.complete ? 'Calibrated! Starting…'
          : calibration.progress > 0 ? `Keep still · ${remaining} seconds to go`
          : 'The countdown starts automatically once everyone is calibrated.';
        drawShadowText(g, message, 800, 862, { size: 22, align: 'center', color: '#e6f8ff' });
        return;
      }

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
          const hold = session.readySince === null ? 0 : clamp01((performance.now() - session.readySince) / READY_HOLD_MS);
          const allReady = readiness.every((r) => r === 'ready');
          drawPill(g, GAME_READY_START, {
            label: allReady ? 'Starting…' : 'Start now', sub: allReady ? '' : 'no tracking :(',
            icon: 'play', hover: h.start ?? 0, press: press('start'),
          });
          if (hold > 0) drawProgress(g, { x: GAME_READY_START.x + 40, y: GAME_READY_START.y + GAME_READY_START.h + 18, w: GAME_READY_START.w - 80, h: 12 }, hold);
        }
        return;
      }

      if (ph === 'results') return; // ResultsScreen owns every completed round.

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
      for (const key of ['gamePhase', 'gameCountdown', 'gameTimeMs', 'gameScores', 'gameCalibrationProgress', 'gameCalibrationPlayers', 'gameCalibrationPreview']) delete gl.domElement.dataset[key];
      st.reported = '';
    }
    ui.invalidate();
  }, [visible, gl, st, ui]);

  return null;
}
