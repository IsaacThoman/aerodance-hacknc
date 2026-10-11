import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import {
  FONT, ICONS, drawChip, drawGlassCircle, drawGlassPanel, drawHeader, drawPill, drawProgress, drawShadowText, ellipsize,
  paragraph, text,
} from '../ui/draw.js';
import useCanvasUI from '../ui/useCanvasUI.js';
import { playUISound } from '../audio/uiSounds.js';
import { duckMenuMusic } from '../audio/mixer.js';
import { createSongPlayer } from '../audio/songPlayer.js';
import { loadSongBundle } from '../songs/loadBundle.js';
import { validateCatalog } from '../../../packages/pose/song.js';
import { SCORER_VERSION } from '../../../packages/score/scorer.js';
import { bestScore } from './bestScores.js';
import { preloadStage, resolveStage, stageName } from '../../../packages/stages/index.js';
import {
  BACK, BAR, DANCE, PAGE_DOWN, PAGE_UP, PLAY, RETRY, ROWS, SCRUB, rowRect,
} from './layout.js';

/**
 * Song Select, drawn in-engine after the player count is picked (menu/MainMenu.jsx).
 *
 *   list     the published songs (songs/manifest.json, found by server/songCatalog.js),
 *            four to a page
 *   preview  a song's music with its reference dancers on the song's stage (StageView,
 *            mounted by App from onPreviewChange; each song's stage is picked in Dance
 *            Studio), play / pause, a scrubbable timeline and Dance!, which hands the
 *            bundle to the game (onDance); the menu music ducks underneath
 *
 * Bundles are fully verified before they play (songs/loadBundle.js). Back / Escape / the
 * remote's B go from the preview to the list and from the list to the player count.
 * The canvas reports data-song-screen, -song-ready, -catalog, -song-count, -player-slots, -preview-state
 * and -preview-time-ms for tests.
 *
 * <SongSelect visible blocked playerCount={1} connection={view} onBack onOpenConnect
 *   stageState={{ showing, ready, stage, failed }} onPreviewChange onDance />
 */

const CATALOG_URL = () => new URL(`${import.meta.env.BASE_URL}songs/manifest.json`, window.location.href).href;
const ACTIVE = ['connecting', 'reconnecting'];
const fmt = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const SCRUB_HIT = { x: SCRUB.x - 12, y: SCRUB.y - 24, w: SCRUB.w + 24, h: SCRUB.h + 48 };

// Each player's tracking, from the pose input (reported for tests as data-player-slots).
function slotStatus(connection, id) {
  if (connection.status === 'dummy') return { label: 'Preview ready', kind: 'preview' };
  if (connection.snapshot?.poses?.some((p) => p.playerId === id)) return { label: 'Detected', kind: 'detected' };
  if (connection.status === 'initializing') return { label: 'Camera starting…' };
  if (connection.status === 'connected') return { label: 'Step into view' };
  if (ACTIVE.includes(connection.status)) return { label: 'Connecting…' };
  return { label: 'Connect Client' };
}

export default function SongSelect({
  visible = false, blocked = false, playerCount = 1, connection, onBack,
  stageState = {}, onPreviewChange, onDance,
}) {
  const gl = useThree((state) => state.gl);
  const props = useRef({});
  props.current = { visible, blocked, playerCount, connection, onBack, stageState, onPreviewChange, onDance };
  const st = useRef({
    alpha: 0, screen: 'list', next: 'list', swap: 1, page: 0,
    catalog: { status: 'idle', songs: [], error: '' }, catalogCtl: null,
    loading: null, loadError: '',
    bundle: null, player: null, routine: null, previewState: 'loading', previewError: '', scrubMs: null,
    drawn: '', reported: '',
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
    preloadStage(resolveStage(song.stage));
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
  const dance = () => {
    const { bundle } = st;
    if (!bundle) return;
    closePreview();
    props.current.onDance?.(bundle);
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
          { id: 'dance', rect: DANCE },
        ];
        if (st.player) list.push({ id: 'play', rect: PLAY }, { id: 'scrub', drag: true, rect: SCRUB_HIT });
        return list;
      }
      const list = [{ id: 'back', circle: BACK }];
      if (st.catalog.status === 'ready') {
        if (!st.loading) pageSongs().forEach((song, i) => list.push({ id: `song-${song.id}`, song, rect: rowRect(i) }));
        if (st.page > 0) list.push({ id: 'page-up', circle: PAGE_UP });
        if (st.page < pages() - 1) list.push({ id: 'page-down', circle: PAGE_DOWN });
      }
      if (st.catalog.status === 'error') list.push({ id: 'retry', rect: RETRY });
      return list;
    },
    onActivate: (wdg, s) => {
      if (wdg.song) chooseSong(wdg.song);
      else if (wdg.id === 'back') back();
      else if (wdg.id === 'page-up') st.page = Math.max(0, st.page - 1);
      else if (wdg.id === 'page-down') st.page = Math.min(pages() - 1, st.page + 1);
      else if (wdg.id === 'retry') fetchCatalog();
      else if (wdg.id === 'play') togglePlay();
      else if (wdg.id === 'dance') dance();
      s.invalidate();
    },
    onDrag: (_wdg, p) => {
      const { song } = st.bundle ?? {};
      if (!song) return;
      const k = Math.min(1, Math.max(0, (p.x - SCRUB.x) / SCRUB.w));
      st.scrubMs = song.playableStartMs + k * (song.playableEndMs - song.playableStartMs);
    },
    onKey: (e, s) => {
      // A held key shouldn't run through screens.
      if (!live() || e.repeat) return;
      if (e.key === 'Escape') { playUISound('back'); back(); }
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
        p.stageState.stage, p.stageState.ready, p.stageState.failed,
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

      if (st.screen === 'list') {
        drawHeader(g, BACK, 'SONG SELECT', h.back ?? 0);

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
            const best = bestScore(song.id, p.playerCount, SCORER_VERSION);
            const sub = loadingThis ? `Loading bundle${dots}` : [song.artist, song.difficulty ?? 'Routine', song.stage ? stageName(song.stage) : null,
              best ? `Best ${best.score.toLocaleString('en-US')} ${best.grade}` : null].filter(Boolean).join(' · ');
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
      } else if (st.bundle) {
        const { song } = st.bundle;
        drawHeader(g, BACK, 'PREVIEW', h.back ?? 0);
        drawChip(g, 400, BACK.y - 22, `${p.playerCount === 1 ? 'ONE' : 'TWO'} PLAYER PREVIEW`, '#bff4ff');
        g.font = `800 64px ${FONT}`;
        drawShadowText(g, ellipsize(g, song.title, 900), BACK.x - 38, BACK.y + 84, { size: 64, weight: 800 });
        g.font = `700 30px ${FONT}`;
        drawShadowText(g, ellipsize(g, `${song.artist} · ${stageName(resolveStage(song.stage))}`, 900), BACK.x - 36, BACK.y + 140, { size: 30, color: '#d8f6ff' });

        const stageFailed = p.stageState.failed && p.stageState.stage === resolveStage(song.stage);
        const error = st.previewError || (stageFailed ? "This song's stage couldn't load." : p.stageState.dancersFailed ? 'Character preview could not load.' : '');
        if (error) drawShadowText(g, error, BAR.x, BAR.y - 86, { size: 26, color: '#ffb38a' });
        drawShadowText(g, 'Preview the routine, then press Dance! to play it for a score.', BAR.x, BAR.y - 34, { size: 21, weight: 600, color: '#e6f8ff' });
        drawPill(g, DANCE, { label: 'Dance!', sub: p.playerCount === 1 ? 'One player' : 'Two players', icon: 'play', hover: h.dance ?? 0, press: press('dance') });
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
