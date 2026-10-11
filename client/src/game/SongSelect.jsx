import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import {
  FONT, ICONS, TAU, drawCaps, drawChip, drawGlassCircle, drawGlassPanel, drawHeader, drawLink, drawPill, drawPlayerLeds,
  drawProgress, drawShadowText, ellipsize, paragraph, roundRect, text,
} from '../ui/draw.js';
import useCanvasUI from '../ui/useCanvasUI.js';
import { playUISound } from '../audio/uiSounds.js';
import { duckMenuMusic } from '../audio/mixer.js';
import { createSongPlayer } from '../audio/songPlayer.js';
import { loadSongBundle } from '../songs/loadBundle.js';
import { validateCatalog } from '../../../packages/pose/song.js';
import { STAGE_LIST, preloadStage, resolveStage, stageName } from '../../../packages/stages/index.js';
import {
  BACK, BAR, LINK_Y, PAGE_DOWN, PAGE_UP, PLAY, READY, RETRY, ROWS, SCRUB, STAGE_CARD, STAGE_NEXT, STAGE_PREV, rowRect, slotRect,
} from './layout.js';

/**
 * Song Select, drawn in-engine after the player count is picked (menu/MainMenu.jsx).
 *
 *   list     the published songs (songs/manifest.json, found by server/songCatalog.js),
 *            four to a page, and each player's readiness from the pose input
 *   preview  a song's music with its reference dancers on the song's stage (StageView,
 *            mounted by App from onPreviewChange), a stage picker, play / pause and a
 *            scrubbable timeline; the menu music ducks underneath
 *
 * Bundles are fully verified before they play (songs/loadBundle.js). Back / Escape / the
 * remote's B go from the preview to the list and from the list to the player count.
 * The canvas reports data-song-screen, -song-ready, -catalog, -song-count, -player-slots, -preview-state
 * and -preview-time-ms for tests.
 *
 * <SongSelect visible blocked playerCount={1} connection={view} onBack onOpenConnect
 *   stageId stageState={{ showing, ready, stage, failed }} onStageChange onPreviewChange />
 */

const CATALOG_URL = () => new URL(`${import.meta.env.BASE_URL}songs/manifest.json`, window.location.href).href;
const PLACEMENT_CUE = 'Stand in separate camera halves: player 1 on the left, player 2 on the right of the unmirrored camera image.';
const ACTIVE = ['connecting', 'reconnecting'];
const fmt = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const SCRUB_HIT = { x: SCRUB.x - 12, y: SCRUB.y - 24, w: SCRUB.w + 24, h: SCRUB.h + 48 };

// What each player slot says, from the pose input.
function slotStatus(connection, id) {
  if (connection.status === 'dummy') return { label: 'Preview ready', kind: 'preview' };
  if (connection.snapshot?.poses?.some((p) => p.playerId === id)) return { label: 'Detected', kind: 'detected' };
  if (connection.status === 'initializing') return { label: 'Camera starting…' };
  if (connection.status === 'connected') return { label: 'Step into view' };
  if (ACTIVE.includes(connection.status)) return { label: 'Connecting…' };
  return { label: 'Connect Client' };
}

function cuesFor(connection, playerCount) {
  const cues = [];
  if (connection.status === 'connected' && connection.model === 'synthetic') cues.push(['Synthetic test source · tracking is simulated.']);
  if (connection.status === 'initializing' && connection.message) cues.push([connection.message]);
  if (connection.status === 'dummy') cues.push(['Webcam dummy · menu testing enabled · camera capture and tracking are not implemented.']);
  if (playerCount === 2 && connection.status !== 'dummy') cues.push([PLACEMENT_CUE, '#ffe27a']);
  return cues;
}

function drawSlot(g, rect, i, status, hover) {
  const { x, y, w, h } = rect;
  const lift = hover * 2;
  g.save();
  roundRect(g, x, y - lift, w, h, 24);
  g.fillStyle = `rgba(0, 30, 70, ${0.32 + hover * 0.08})`;
  g.fill();
  if (status.kind === 'preview') g.setLineDash([10, 8]);
  g.lineWidth = status.kind ? 3 : 2;
  g.strokeStyle = status.kind === 'detected' ? '#6ff3d6' : status.kind === 'preview' ? '#a9d5ff' : `rgba(255,255,255,${0.45 + hover * 0.4})`;
  g.stroke();
  g.restore();
  const cy = y + h / 2 - lift;
  drawPlayerLeds(g, x + 66, cy, { player: i + 1, glow: status.kind === 'detected' ? 1 : 0.35, scale: 0.42 });
  drawCaps(g, `PLAYER ${i + 1}`, x + 120, cy - 17, { size: 17 });
  g.font = `700 25px ${FONT}`;
  text(g, ellipsize(g, status.label, w - 132), x + 120, cy + 17, { size: 25, weight: 700, color: status.kind === 'detected' ? '#9effdf' : '#ffffff' });
}

function drawStageCard(g, stageId, songStage, stageState, hover, press) {
  const stage = STAGE_LIST.find((s) => s.id === stageId);
  drawGlassPanel(g, STAGE_CARD, 30);
  for (const [c, id, icon] of [[STAGE_PREV, 'stage-prev', 'left'], [STAGE_NEXT, 'stage-next', 'right']]) {
    const hv = hover[id] ?? 0;
    const cc = { ...c, r: c.r + press(id) * -2 };
    drawGlassCircle(g, cc, hv);
    g.lineWidth = 4;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = '#ffffff';
    ICONS[icon](g, c.x, c.y, c.r * 1.5);
  }
  const cx = STAGE_CARD.x + STAGE_CARD.w / 2;
  const maxW = STAGE_CARD.w - 170;
  // Accent orb, like the /dance/ name card.
  const [light, dark] = stage.accent;
  g.font = `800 30px ${FONT}`;
  const name = ellipsize(g, stage.name, maxW - 34);
  const nameW = g.measureText(name).width;
  const ox = cx - nameW / 2 - 22;
  const oy = STAGE_CARD.y + 44;
  const orb = g.createRadialGradient(ox - 4, oy - 5, 1, ox, oy, 12);
  orb.addColorStop(0, '#ffffff');
  orb.addColorStop(0.35, light);
  orb.addColorStop(1, dark);
  g.beginPath();
  g.arc(ox, oy, 11, 0, TAU);
  g.fillStyle = orb;
  g.fill();
  drawShadowText(g, name, cx + 14, STAGE_CARD.y + 44, { size: 30, weight: 800, align: 'center' });
  const loading = stageState.stage !== stageId || (!stageState.ready && !stageState.failed);
  const sub = stageState.failed && stageState.stage === stageId ? ["This stage couldn't load.", '#ffb38a']
    : loading ? ['Loading stage…', '#bff4ff'] : [stage.subtitle, '#bff4ff'];
  g.font = `600 20px ${FONT}`;
  text(g, ellipsize(g, sub[0], maxW), cx, STAGE_CARD.y + 78, { size: 20, color: sub[1], align: 'center' });
  // Where this stage sits in the list; the ring marks the song's own stage.
  const gap = 24;
  STAGE_LIST.forEach((s, i) => {
    const dx = cx + (i - (STAGE_LIST.length - 1) / 2) * gap;
    const dy = STAGE_CARD.y + 110;
    g.beginPath();
    g.arc(dx, dy, s.id === stageId ? 6 : 4.5, 0, TAU);
    g.fillStyle = s.id === stageId ? '#ffffff' : 'rgba(255,255,255,0.4)';
    g.fill();
    if (s.id === songStage) {
      g.beginPath();
      g.arc(dx, dy, 10, 0, TAU);
      g.lineWidth = 2;
      g.strokeStyle = '#6ff3d6';
      g.stroke();
    }
  });
}

export default function SongSelect({
  visible = false, blocked = false, playerCount = 1, connection, onBack, onOpenConnect,
  stageId, stageState = {}, onStageChange, onPreviewChange,
}) {
  const gl = useThree((state) => state.gl);
  const props = useRef({});
  props.current = { visible, blocked, playerCount, connection, onBack, onOpenConnect, stageId, stageState, onStageChange, onPreviewChange };
  const st = useRef({
    alpha: 0, screen: 'list', next: 'list', swap: 1, page: 0,
    catalog: { status: 'idle', songs: [], error: '' }, catalogCtl: null,
    loading: null, loadError: '',
    bundle: null, player: null, routine: null, previewState: 'loading', previewError: '', scrubMs: null,
    linkRect: null, drawn: '', reported: '',
  }).current;

  const songs = () => st.catalog.songs.filter((song) => song.supportedPlayerCounts.includes(props.current.playerCount));
  const pages = () => Math.max(1, Math.ceil(songs().length / ROWS.perPage));
  const pageSongs = () => songs().slice(st.page * ROWS.perPage, (st.page + 1) * ROWS.perPage);
  const live = () => props.current.visible && !props.current.blocked && st.alpha > 0.3 && st.screen === st.next;
  const go = (screen) => {
    if (screen === st.next) return;
    st.next = screen;
    if (ui.pointerKind === 'key') ui.pointer = null;
  };

  const fetchCatalog = () => {
    st.catalogCtl?.abort();
    const ctl = new AbortController();
    st.catalogCtl = ctl;
    st.catalog = { status: 'loading', songs: [], error: '' };
    fetch(CATALOG_URL(), { signal: ctl.signal, cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw Error('Song catalog could not load.');
        return response.json();
      })
      .then((data) => {
        const catalog = validateCatalog(data);
        st.catalog = { status: 'ready', songs: catalog.songs, error: '' };
        st.page = 0;
      })
      .catch((error) => {
        if (ctl.signal.aborted) return;
        st.catalog = { status: 'error', songs: [], error: error.message || 'Song catalog could not load.' };
      })
      .finally(() => { if (!ctl.signal.aborted) ui.invalidate(); });
  };

  const closePreview = () => {
    st.player?.dispose();
    st.player = null;
    st.bundle = null;
    st.routine = null;
    st.scrubMs = null;
    duckMenuMusic(false);
    props.current.onPreviewChange?.(null);
  };

  const openPreview = (bundle) => {
    const { song } = bundle;
    st.bundle = bundle;
    st.previewState = 'loading';
    st.previewError = '';
    const routine = {
      bundle,
      playerCount: props.current.playerCount,
      // While the timeline is dragged the dancers follow the knob.
      timeMs: () => st.scrubMs ?? st.player?.timeMs() ?? song.playableStartMs,
      playing: () => st.player?.state === 'playing',
    };
    st.routine = routine;
    const stage = resolveStage(song.stage);
    preloadStage(stage);
    props.current.onStageChange?.(stage);
    props.current.onPreviewChange?.(routine);
    duckMenuMusic(true);
    go('preview');
    createSongPlayer(bundle.audio, { startMs: song.playableStartMs, endMs: song.playableEndMs })
      .then((player) => {
        if (st.bundle !== bundle) { player.dispose(); return; }
        st.player = player;
        st.previewState = player.state;
        player.onChange(() => { st.previewState = player.state; ui.invalidate(); });
      })
      .catch(() => {
        if (st.bundle !== bundle) return;
        st.previewState = 'error';
        st.previewError = 'This browser could not decode the song audio.';
      })
      .finally(() => ui.invalidate());
  };

  const chooseSong = (entry) => {
    st.loading?.controller.abort();
    const controller = new AbortController();
    st.loading = { id: entry.id, controller };
    st.loadError = '';
    loadSongBundle(entry, CATALOG_URL(), { signal: controller.signal })
      .then((bundle) => { if (!controller.signal.aborted && props.current.visible) openPreview(bundle); })
      .catch((error) => { if (!controller.signal.aborted) st.loadError = error.message; })
      .finally(() => {
        if (controller.signal.aborted) return;
        st.loading = null;
        ui.invalidate();
      });
  };

  const back = () => {
    if (st.screen === 'preview') { closePreview(); go('list'); return; }
    st.loading?.controller.abort();
    st.loading = null;
    props.current.onBack?.();
  };
  const stepStage = (dir) => {
    const i = STAGE_LIST.findIndex((s) => s.id === props.current.stageId);
    const next = STAGE_LIST[(i + dir + STAGE_LIST.length) % STAGE_LIST.length].id;
    preloadStage(STAGE_LIST[(i + dir * 2 + STAGE_LIST.length * 2) % STAGE_LIST.length].id);
    props.current.onStageChange?.(next);
  };
  const togglePlay = () => {
    const { player } = st;
    if (!player) return;
    if (player.state === 'playing') player.pause();
    else player.play();
  };

  const ui = useCanvasUI({
    priority: 2,
    active: live,
    keyNav: true,
    widgets: () => {
      if (st.screen === 'preview') {
        const list = [
          { id: 'back', circle: BACK },
          { id: 'stage-prev', circle: STAGE_PREV },
          { id: 'stage-next', circle: STAGE_NEXT },
        ];
        if (st.player) list.push({ id: 'play', rect: PLAY }, { id: 'scrub', drag: true, rect: SCRUB_HIT });
        return list;
      }
      const { playerCount: n } = props.current;
      const list = [{ id: 'back', circle: BACK }];
      if (st.catalog.status === 'ready') {
        if (!st.loading) pageSongs().forEach((song, i) => list.push({ id: `song-${song.id}`, song, rect: rowRect(i) }));
        if (st.page > 0) list.push({ id: 'page-up', circle: PAGE_UP });
        if (st.page < pages() - 1) list.push({ id: 'page-down', circle: PAGE_DOWN });
      }
      if (st.catalog.status === 'error') list.push({ id: 'retry', rect: RETRY });
      if (st.linkRect) list.push({ id: 'demo', rect: st.linkRect });
      for (let i = 0; i < n; i++) list.push({ id: `slot-${i}`, rect: slotRect(i) });
      return list;
    },
    onActivate: (wdg, s) => {
      if (wdg.song) chooseSong(wdg.song);
      else if (wdg.id === 'back') back();
      else if (wdg.id === 'page-up') st.page = Math.max(0, st.page - 1);
      else if (wdg.id === 'page-down') st.page = Math.min(pages() - 1, st.page + 1);
      else if (wdg.id === 'retry') fetchCatalog();
      else if (wdg.id === 'demo') window.open('/dance/', '_blank', 'noopener');
      else if (wdg.id.startsWith('slot-')) props.current.onOpenConnect?.();
      else if (wdg.id === 'stage-prev') stepStage(-1);
      else if (wdg.id === 'stage-next') stepStage(1);
      else if (wdg.id === 'play') togglePlay();
      s.invalidate();
    },
    onDrag: (_wdg, p) => {
      const { song } = st.bundle ?? {};
      if (!song) return;
      const k = Math.min(1, Math.max(0, (p.x - SCRUB.x) / SCRUB.w));
      st.scrubMs = song.playableStartMs + k * (song.playableEndMs - song.playableStartMs);
    },
    onKey: (e, s) => {
      if (!live()) return;
      if (e.key === 'Escape') { playUISound('back'); back(); }
      else if (st.screen === 'preview' && e.key === 'ArrowLeft') { playUISound('select'); stepStage(-1); }
      else if (st.screen === 'preview' && e.key === 'ArrowRight') { playUISound('select'); stepStage(1); }
      else if (st.screen === 'preview' && e.key === ' ' && s.pointerKind !== 'key') { playUISound('select'); togglePlay(); }
      else return;
      e.preventDefault();
      s.invalidate();
    },
    onBack: (s) => { back(); s.invalidate(); },
    update: (dt, s) => {
      const p = props.current;
      if (st.next !== st.screen) {
        st.swap = Math.max(0, st.swap - dt * 7);
        if (st.swap === 0) st.screen = st.next;
        s.invalidate();
      } else if (st.swap < 1) {
        st.swap = Math.min(1, st.swap + dt * 6);
        s.invalidate();
      }
      st.alpha = s.ease(st.alpha, p.visible ? 1 : 0, p.visible ? 3 : 6);
      // A finished drag on the timeline seeks the song.
      if (st.scrubMs !== null && !s.drag) {
        st.player?.seek(st.scrubMs);
        st.scrubMs = null;
      }
      const c = p.connection;
      const slots = Array.from({ length: p.playerCount }, (_, i) => slotStatus(c, i).label);
      const key = [
        st.screen, st.catalog.status, st.page, st.loading?.id, st.loadError, st.previewState, st.previewError,
        slots.join('|'), cuesFor(c, p.playerCount).map(([t]) => t).join('|'), p.stageId, p.stageState.stage, p.stageState.ready, p.stageState.failed,
      ].join('~');
      if (key !== st.drawn) { st.drawn = key; s.invalidate(); }
      // The timeline and clock move while the song plays or is dragged.
      if (st.screen === 'preview' && (st.previewState === 'playing' || st.scrubMs !== null)) s.invalidate();
      if (st.catalog.status === 'loading' || st.loading) s.invalidate();

      const report = {
        songScreen: st.screen,
        songReady: String(live() && st.swap > 0.95),
        catalog: st.catalog.status === 'ready' && !songs().length ? 'empty' : st.catalog.status,
        songCount: String(songs().length),
        playerSlots: slots.join('|'),
        previewState: st.screen === 'preview' ? (st.previewError ? 'error' : st.previewState) : '',
        previewTimeMs: st.routine ? String(Math.round(st.routine.timeMs())) : '',
      };
      const json = JSON.stringify(report);
      if (json !== st.reported) { st.reported = json; Object.assign(gl.domElement.dataset, report); }
    },
    opacity: () => st.alpha,
    draw: (g, s) => {
      const p = props.current;
      const h = s.hover;
      const press = (id) => s.press * (h[id] ?? 0);
      const t = st.swap;
      g.save();
      g.globalAlpha = t;
      g.translate((1 - t) * -24, 0);
      const playersLabel = p.playerCount === 1 ? 'ONE PLAYER' : 'TWO PLAYERS';

      if (st.screen === 'list') {
        drawHeader(g, BACK, 'SONG SELECT', h.back ?? 0);
        drawChip(g, 528, BACK.y - 22, playersLabel, '#bff4ff');
        drawShadowText(g, 'Find your rhythm. Follow the dancers.', ROWS.x, 214, { size: 30, weight: 700 });

        const dots = '.'.repeat(1 + (Math.floor(s.time * 3) % 3));
        const list = songs();
        if (st.catalog.status === 'loading') {
          drawShadowText(g, `Loading songs${dots}`, ROWS.x, ROWS.y + 46, { size: 30, weight: 700 });
        } else if (st.catalog.status === 'error') {
          g.font = `700 28px ${FONT}`;
          drawShadowText(g, ellipsize(g, st.catalog.error, ROWS.w), ROWS.x, ROWS.y + 46, { size: 28, color: '#ffb38a' });
          drawPill(g, RETRY, { label: 'Retry', icon: 'replay', hover: h.retry ?? 0, press: press('retry') });
        } else if (!list.length) {
          drawShadowText(g, 'The first routine is on its way', ROWS.x, ROWS.y + 40, { size: 38, weight: 800 });
          g.save();
          g.shadowColor = 'rgba(0, 34, 84, 0.75)';
          g.shadowBlur = 5;
          g.shadowOffsetY = 2;
          paragraph(g, 'No playable songs have been published yet. Each routine needs music and choreography for both players.', ROWS.x, ROWS.y + 96, ROWS.w, { size: 25, color: '#ffffff' });
          g.restore();
        } else {
          pageSongs().forEach((song, i) => {
            const rect = rowRect(i);
            const id = `song-${song.id}`;
            const loadingThis = st.loading?.id === song.id;
            g.font = `700 ${Math.round(rect.h * 0.34)}px ${FONT}`;
            const label = ellipsize(g, song.title, rect.w - rect.h - 44);
            const sub = loadingThis ? `Loading bundle${dots}` : [song.artist, song.difficulty ?? 'Routine', song.stage ? stageName(song.stage) : null].filter(Boolean).join(' · ');
            g.font = `600 ${Math.round(rect.h * 0.22)}px ${FONT}`;
            drawPill(g, rect, {
              label, sub: ellipsize(g, sub, rect.w - rect.h - 44), icon: 'note',
              hover: h[id] ?? 0, press: press(id), disabled: !!st.loading && !loadingThis,
            });
          });
          if (pages() > 1) {
            for (const [c, id, icon, on] of [[PAGE_UP, 'page-up', 'up', st.page > 0], [PAGE_DOWN, 'page-down', 'down', st.page < pages() - 1]]) {
              g.save();
              if (!on) g.globalAlpha *= 0.35;
              drawGlassCircle(g, c, on ? h[id] ?? 0 : 0);
              g.lineWidth = 4;
              g.lineCap = 'round';
              g.lineJoin = 'round';
              g.strokeStyle = '#ffffff';
              ICONS[icon](g, c.x, c.y, c.r * 1.5);
              g.restore();
            }
            drawShadowText(g, `${st.page + 1}/${pages()}`, PAGE_UP.x, (PAGE_UP.y + PAGE_DOWN.y) / 2, { size: 22, weight: 700, align: 'center' });
          }
          if (st.loadError) {
            g.font = `700 24px ${FONT}`;
            drawShadowText(g, ellipsize(g, st.loadError, ROWS.w + 60), ROWS.x, ROWS.y + ROWS.perPage * (ROWS.h + ROWS.gap) + 14, { size: 24, color: '#ffb38a' });
          }
        }
        g.save();
        g.shadowColor = 'rgba(0, 34, 84, 0.8)';
        g.shadowBlur = 5;
        g.shadowOffsetY = 2;
        st.linkRect = drawLink(g, 'Watch the captured dance preview ↗', ROWS.x, LINK_Y, (h.demo ?? 0) > 0.5, { size: 26 });
        g.restore();
        drawShadowText(g, 'Music and reference dancers · no scoring yet', ROWS.x, LINK_Y + 50, { size: 22, weight: 600, color: '#e6f8ff' });

        // Readiness: one slot per player, then whatever the pose input needs to say.
        const c = p.connection;
        const cues = cuesFor(c, p.playerCount);
        g.font = `600 21px ${FONT}`;
        const cueLines = cues.reduce((n, [cue]) => n + Math.ceil(g.measureText(cue).width / (READY.w - 64)) + 0.3, 0);
        const panel = { ...READY, h: 182 + Math.ceil(cueLines * 28) + (cues.length ? 10 : 0) };
        drawGlassPanel(g, panel, 30);
        drawCaps(g, 'PLAYERS', READY.x + 32, READY.y + 38, { size: 22 });
        for (let i = 0; i < p.playerCount; i++) drawSlot(g, slotRect(i), i, slotStatus(c, i), h[`slot-${i}`] ?? 0);
        let cy = READY.y + 186;
        for (const [cue, color] of cues) {
          cy += paragraph(g, cue, READY.x + 34, cy, READY.w - 68, { size: 21, lineH: 28, color: color ?? 'rgba(255,255,255,0.9)' }) + 8;
        }
      } else if (st.bundle) {
        const { song } = st.bundle;
        drawHeader(g, BACK, 'PREVIEW', h.back ?? 0);
        drawChip(g, 400, BACK.y - 22, `${p.playerCount === 1 ? 'ONE' : 'TWO'} PLAYER PREVIEW`, '#bff4ff');
        g.font = `800 64px ${FONT}`;
        drawShadowText(g, ellipsize(g, song.title, 900), BACK.x - 38, BACK.y + 84, { size: 64, weight: 800 });
        g.font = `700 30px ${FONT}`;
        drawShadowText(g, ellipsize(g, song.artist, 900), BACK.x - 36, BACK.y + 140, { size: 30, color: '#d8f6ff' });

        drawStageCard(g, p.stageId, resolveStage(song.stage), p.stageState, h, press);

        const error = st.previewError || (p.stageState.dancersFailed ? 'Character preview could not load.' : '');
        if (error) drawShadowText(g, error, BAR.x, BAR.y - 86, { size: 26, color: '#ffb38a' });
        drawShadowText(g, 'Music and reference choreography preview · scoring and countdown are still in development.', BAR.x, BAR.y - 34, { size: 21, weight: 600, color: '#e6f8ff' });
        drawGlassPanel(g, BAR, 30);
        const playing = st.previewState === 'playing';
        drawPill(g, PLAY, {
          label: st.player ? (playing ? 'Pause' : 'Play') : st.previewError ? 'No audio' : 'Loading…',
          icon: playing ? 'pause' : 'play', hover: h.play ?? 0, press: press('play'), disabled: !st.player,
        });
        const start = song.playableStartMs;
        const total = song.playableEndMs - start;
        const now = st.routine.timeMs();
        drawProgress(g, SCRUB, (now - start) / total, { hover: h.scrub ?? 0, knob: !!st.player });
        text(g, `${fmt(now - start)} / ${fmt(total)}`, BAR.x + BAR.w - 30, BAR.y + BAR.h / 2 + 1, { size: 26, weight: 700, align: 'right' });
      }
      g.restore();
    },
  });

  // Opening Song Select loads the catalog; leaving it stops everything.
  useEffect(() => {
    if (visible) {
      st.screen = st.next = 'list';
      st.swap = 1;
      st.loadError = '';
      fetchCatalog();
      ui.invalidate();
      return undefined;
    }
    st.catalogCtl?.abort();
    st.loading?.controller.abort();
    st.loading = null;
    if (st.bundle) closePreview();
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // A hidden tab pauses the song.
  useEffect(() => {
    const onVisibility = () => { if (document.hidden) st.player?.pause(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [st]);

  useEffect(() => () => {
    st.player?.dispose();
    duckMenuMusic(false);
  }, [st]);

  return null;
}
