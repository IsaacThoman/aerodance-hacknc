import { useEffect, useRef } from 'react';
import { FONT, TAU, drawGlassPanel, drawHeader, drawPill, drawTitle, pill } from '../ui/draw.js';
import useCanvasUI from '../ui/useCanvasUI.js';

/**
 * Title menu drawn in-engine (see ui/useCanvasUI.js), laid out in 16:9 design units and
 * drawn after the world (useFrame priority 2).
 *
 * Screens: main (Start, Battle, Settings), start (random / select song), songs (song list),
 * settings (sound). Battle hands off to the battle lobby (battle/BattleScreen.jsx).
 *
 * <MainMenu visible onStart={(mode, song) => ...} onBattle={() => ...} sound={sound} onSoundChange={setSound} />
 */

// Design space is 1600x900 (16:9); everything below is in these units.
const TITLE = { x: 124, y: 418, size: 156 };

// Main screen.
const START = { x: 128, y: 482, w: 440, h: 104 };
const BATTLE = { x: 128, y: 602, w: 440, h: 104 };
const SETTINGS = { x: 128, y: 722, w: 440, h: 104 };

// Submenus share a header row: back button + small caps heading.
const BACK = { x: 166, y: 500, r: 30 };
const RANDOM = { x: 128, y: 550, w: 470, h: 96 };
const SELECT = { x: 128, y: 666, w: 470, h: 96 };
// Placeholder track list until real songs exist.
const SONGS = [
  { id: 'song-1', title: 'Song Title One', artist: 'Artist Name' },
  { id: 'song-2', title: 'Song Title Two', artist: 'Artist Name' },
];
const SONG_RECTS = SONGS.map((_, i) => ({ x: 128, y: 550 + i * 116, w: 520, h: 96 }));
const PANEL = { x: 128, y: 548, w: 600, h: 284 };
const SLIDERS = [
  { key: 'master', label: 'Master' },
  { key: 'music', label: 'Music' },
  { key: 'sfx', label: 'Effects' },
];
const ROW_Y = (i) => PANEL.y + 54 + i * 60;
const TRACK = { x0: PANEL.x + 190, x1: PANEL.x + PANEL.w - 110 };

const WIDGETS = {
  main: [
    { id: 'start', rect: START },
    { id: 'battle', rect: BATTLE },
    { id: 'settings', rect: SETTINGS },
  ],
  start: [
    { id: 'back', circle: BACK },
    { id: 'random', rect: RANDOM },
    { id: 'select', rect: SELECT },
  ],
  songs: [
    { id: 'back', circle: BACK },
    ...SONGS.map((song, i) => ({ id: song.id, song, rect: SONG_RECTS[i] })),
  ],
  settings: [
    { id: 'back', circle: BACK },
    ...SLIDERS.map((sl, i) => ({ id: sl.key, drag: true, rect: { x: TRACK.x0 - 24, y: ROW_Y(i) - 28, w: TRACK.x1 - TRACK.x0 + 48, h: 56 } })),
    { id: 'muted', rect: { x: PANEL.x + 16, y: ROW_Y(3) - 28, w: PANEL.w - 32, h: 56 } },
  ],
};
// Where back / Escape leads from each submenu.
const PARENT = { start: 'main', settings: 'main', songs: 'start' };

const sliderValue = (x) => Math.min(1, Math.max(0, (x - TRACK.x0) / (TRACK.x1 - TRACK.x0)));

function drawSoundPanel(g, sound, hover) {
  const { x, w } = PANEL;
  const base = g.globalAlpha;
  drawGlassPanel(g, PANEL, 34);

  const label = (text, cy) => {
    g.font = `600 30px ${FONT}`;
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    g.fillText(text, x + 40, cy + 1);
  };

  SLIDERS.forEach((sl, i) => {
    const cy = ROW_Y(i);
    const v = sound[sl.key];
    const kx = TRACK.x0 + v * (TRACK.x1 - TRACK.x0);
    const dim = base * (sound.muted ? 0.45 : 1);
    label(sl.label, cy);

    g.globalAlpha = dim;
    pill(g, TRACK.x0 - 6, cy - 7, TRACK.x1 - TRACK.x0 + 12, 14);
    g.fillStyle = 'rgba(0, 30, 70, 0.45)';
    g.fill();
    if (v > 0.01) {
      pill(g, TRACK.x0 - 6, cy - 7, kx - TRACK.x0 + 12, 14);
      const fill = g.createLinearGradient(0, cy - 7, 0, cy + 7);
      fill.addColorStop(0, '#b8fff0');
      fill.addColorStop(1, '#4fd8e8');
      g.fillStyle = fill;
      g.fill();
    }
    g.save();
    g.shadowColor = 'rgba(0, 30, 70, 0.5)';
    g.shadowBlur = 8;
    g.shadowOffsetY = 3;
    g.beginPath();
    g.arc(kx, cy, 17 + (hover[sl.key] ?? 0) * 3, 0, TAU);
    const knob = g.createLinearGradient(0, cy - 18, 0, cy + 18);
    knob.addColorStop(0, '#ffffff');
    knob.addColorStop(1, '#bfeff8');
    g.fillStyle = knob;
    g.fill();
    g.restore();

    g.font = `700 26px ${FONT}`;
    g.textAlign = 'right';
    g.fillStyle = '#ffffff';
    g.fillText(String(Math.round(v * 100)), x + w - 40, cy + 1);
    g.textAlign = 'left';
    g.globalAlpha = base;
  });

  // Mute toggle.
  const cy = ROW_Y(3);
  label('Mute', cy);
  const tw = 84;
  const th = 42;
  pill(g, TRACK.x0, cy - th / 2, tw, th);
  g.fillStyle = sound.muted ? '#4fd8e8' : 'rgba(0, 30, 70, 0.45)';
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = `rgba(255,255,255,${0.5 + (hover.muted ?? 0) * 0.4})`;
  g.stroke();
  const kx = TRACK.x0 + (sound.muted ? tw - th / 2 : th / 2);
  g.beginPath();
  g.arc(kx, cy, th / 2 - 5, 0, TAU);
  g.fillStyle = '#ffffff';
  g.fill();
}

export default function MainMenu({ visible = true, onStart, onBattle, onSettingsOpen, sound, onSoundChange }) {
  const menu = useRef({ spin: 0, gearAngle: 0, alpha: 0, screen: 'main', next: 'main', swap: 1, drawnSound: null });
  const props = useRef({});
  props.current = { visible, onStart, onBattle, onSettingsOpen, sound, onSoundChange };

  const m = menu.current;
  const go = (screen) => { if (screen !== m.next) m.next = screen; };
  const setSound = (patch) => {
    const { sound: cur, onSoundChange: cb } = props.current;
    cb?.({ ...cur, ...patch });
  };

  const ui = useCanvasUI({
    priority: 2,
    // Input goes to the visible screen as soon as it is fading in (never mid swap-out).
    active: () => props.current.visible && m.alpha > 0.3 && m.screen === m.next,
    widgets: () => WIDGETS[m.screen],
    onDrag: (wdg, p) => setSound({ [wdg.id]: sliderValue(p.x) }),
    onActivate: (wdg, s) => {
      if (wdg.song) { props.current.onStart?.('select', wdg.song); return; }
      switch (wdg.id) {
        case 'start': go('start'); break;
        case 'battle': props.current.onBattle?.(); break;
        case 'settings': m.spin += Math.PI / 2; go('settings'); props.current.onSettingsOpen?.(); break;
        case 'back': go(PARENT[m.screen]); break;
        case 'random': props.current.onStart?.('random'); break;
        case 'select': go('songs'); break;
        case 'muted': setSound({ muted: !props.current.sound?.muted }); break;
        default:
      }
      s.invalidate();
    },
    onKey: (e, s) => {
      const active = props.current.visible && m.alpha > 0.3 && m.screen === m.next;
      if (e.key === 'Escape' && active && PARENT[m.screen]) { go(PARENT[m.screen]); s.invalidate(); }
    },
    update: (dt, s) => {
      const shown = props.current.visible;
      // Screen change: fade the current screen out, swap, fade the next one in.
      if (m.next !== m.screen) {
        m.swap = Math.max(0, m.swap - dt * 7);
        if (m.swap === 0) m.screen = m.next;
        s.invalidate();
      } else if (m.swap < 1) {
        m.swap = Math.min(1, m.swap + dt * 6);
        s.invalidate();
      }
      m.alpha = s.ease(m.alpha, shown ? 1 : 0, shown ? 3 : 6);
      m.gearAngle = s.ease(m.gearAngle, m.spin + (s.hover.settings ?? 0) * 0.35, 8);
      if (props.current.sound !== m.drawnSound) s.invalidate();
    },
    opacity: () => m.alpha,
    draw: (g, s) => {
      const snd = props.current.sound;
      m.drawnSound = snd;
      drawTitle(g, TITLE);

      const t = m.swap;
      g.save();
      g.globalAlpha = t;
      g.translate((1 - t) * -24, 0);
      const h = s.hover;
      const press = (id) => s.press * (h[id] ?? 0);
      if (m.screen === 'main') {
        drawPill(g, START, { label: 'Start', icon: 'play', hover: h.start ?? 0, press: press('start') });
        drawPill(g, BATTLE, { label: 'Battle', icon: 'duo', hover: h.battle ?? 0, press: press('battle') });
        drawPill(g, SETTINGS, { label: 'Settings', icon: 'gear', hover: h.settings ?? 0, press: press('settings'), angle: m.gearAngle });
      } else if (m.screen === 'start') {
        drawHeader(g, BACK, 'START', h.back ?? 0);
        drawPill(g, RANDOM, { label: 'Random song', icon: 'shuffle', hover: h.random ?? 0, press: press('random') });
        drawPill(g, SELECT, { label: 'Select song', icon: 'list', hover: h.select ?? 0, press: press('select') });
      } else if (m.screen === 'songs') {
        drawHeader(g, BACK, 'SELECT SONG', h.back ?? 0);
        SONGS.forEach((song, i) => {
          drawPill(g, SONG_RECTS[i], { label: song.title, sub: song.artist, icon: 'note', hover: h[song.id] ?? 0, press: press(song.id) });
        });
      } else {
        drawHeader(g, BACK, 'SOUND', h.back ?? 0);
        drawSoundPanel(g, snd, h);
      }
      g.restore();
    },
  });

  // Reopening the menu always lands on the main screen.
  useEffect(() => {
    if (!visible) return;
    m.screen = m.next = 'main';
    m.swap = 1;
    ui.invalidate();
  }, [visible, m, ui]);

  return null;
}
