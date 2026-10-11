import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { FONT, TAU, drawGlassPanel, drawHeader, drawPill, drawPlayerLeds, drawTitle, pill } from '../ui/draw.js';
import useCanvasUI from '../ui/useCanvasUI.js';
import { playUISound } from '../audio/uiSounds.js';
import RemoteDock from '../remote/RemoteDock.jsx';
import { BACK, BATTLE, ONE_PLAYER, SETTINGS, START, TITLE, TWO_PLAYERS } from './layout.js';

/**
 * Title menu drawn in-engine (see ui/useCanvasUI.js), laid out in 16:9 design units and
 * drawn after the world (useFrame priority 2).
 *
 * Screens: main (Start, Battle, Settings), players (one / two players, then Song Select:
 * game/SongSelect.jsx), settings (sound: Master / Music / Effects volume, Menu music and Mute
 * all, which audio/mixer.js applies; Wii cursor, the Wii hand in place of the mouse
 * pointer; and Show flock, the flock camera behind the menu dancers even with no Android
 * client connected). Battle hands off to the battle lobby (battle/BattleScreen.jsx).
 * The main screen also shows the remote and fullscreen bubbles in the corner.
 *
 * Input comes from the mouse/touch on the canvas, the keyboard (arrows, Enter, Escape) or a
 * paired phone remote (remote/remoteLink.js; B goes back). `blocked` (the Connect Client card
 * is open) holds input. onScreenChange hears which screen is showing (Settings carries the
 * Connect Client pill). The canvas reports data-menu-screen / data-menu-ready for tests.
 *
 * <MainMenu visible initialScreen="main" onStart={(playerCount) => ...} onBattle={() => ...}
 *   onScreenChange={setShown} sound={sound} onSoundChange={setSound} wiiCursor={wiiCursor}
 *   onWiiCursorChange={setWiiCursor} showFlock={showFlock} onShowFlockChange={setShowFlock} />
 */

// Design space is 1600x900 (16:9); the layout is in ./layout.js.
const PANEL = { x: 128, y: 540, w: 600, h: 344 };
const SLIDERS = [
  { key: 'master', label: 'Master' },
  { key: 'music', label: 'Music' },
  { key: 'sfx', label: 'Effects' },
];
// Switches below the sliders: on() reads whether each one is on from the menu's props; audio
// ones also grey out under Mute all.
const TOGGLES = [
  { key: 'menuMusic', label: 'Menu music', audio: true, on: (p) => p.sound.menuMusic !== false },
  { key: 'muted', label: 'Mute all', on: (p) => !!p.sound.muted },
  { key: 'wiiCursor', label: 'Wii cursor', on: (p) => p.wiiCursor !== false },
  { key: 'showFlock', label: 'Show flock', on: (p) => !!p.showFlock },
];
const ROW_H = 44;
const ROW_Y = (i) => PANEL.y + 40 + i * ROW_H;
const SWITCH = { w: 76, h: 38, x: PANEL.x + PANEL.w - 40 - 76 };
const TRACK = { x0: PANEL.x + 190, x1: PANEL.x + PANEL.w - 110 };

const WIDGETS = {
  main: [
    { id: 'start', rect: START },
    { id: 'battle', rect: BATTLE },
    { id: 'settings', rect: SETTINGS },
  ],
  players: [
    { id: 'back', circle: BACK },
    { id: 'one', rect: ONE_PLAYER },
    { id: 'two', rect: TWO_PLAYERS },
  ],
  settings: [
    { id: 'back', circle: BACK },
    ...SLIDERS.map((sl, i) => ({ id: sl.key, drag: true, rect: { x: TRACK.x0 - 24, y: ROW_Y(i) - ROW_H / 2, w: TRACK.x1 - TRACK.x0 + 48, h: ROW_H } })),
    ...TOGGLES.map((tg, i) => ({ id: tg.key, toggle: tg, sound: false, rect: { x: PANEL.x + 16, y: ROW_Y(SLIDERS.length + i) - ROW_H / 2, w: PANEL.w - 32, h: ROW_H } })),
  ],
};
// Where back / Escape leads from each submenu.
const PARENT = { players: 'main', settings: 'main' };

const sliderValue = (x) => Math.min(1, Math.max(0, (x - TRACK.x0) / (TRACK.x1 - TRACK.x0)));

function drawSettingsPanel(g, p, hover) {
  const { sound } = p;
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
    // Only Mute all greys the sliders out; Menu music switches off just the menu track.
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

  // Switches, right-aligned under the slider values.
  TOGGLES.forEach((tg, i) => {
    const cy = ROW_Y(SLIDERS.length + i);
    const on = tg.on(p);
    const { w: tw, h: th, x: tx } = SWITCH;
    g.globalAlpha = base * (tg.audio && sound.muted ? 0.45 : 1);
    label(tg.label, cy);
    pill(g, tx, cy - th / 2, tw, th);
    g.fillStyle = on ? '#4fd8e8' : 'rgba(0, 30, 70, 0.45)';
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = `rgba(255,255,255,${0.5 + (hover[tg.key] ?? 0) * 0.4})`;
    g.stroke();
    const kx = tx + (on ? tw - th / 2 : th / 2);
    g.beginPath();
    g.arc(kx, cy, th / 2 - 5, 0, TAU);
    g.fillStyle = '#ffffff';
    g.fill();
    g.globalAlpha = base;
  });
}

export default function MainMenu({
  visible = true, blocked = false, initialScreen = 'main', onStart, onBattle, onSettingsOpen, onScreenChange, sound, onSoundChange,
  wiiCursor = true, onWiiCursorChange, showFlock = false, onShowFlockChange,
}) {
  const gl = useThree((state) => state.gl);
  const menu = useRef({ spin: 0, gearAngle: 0, alpha: 0, screen: 'main', next: 'main', swap: 1, drawnSound: null, drawnWii: null, drawnFlock: null });
  const props = useRef({});
  props.current = { visible, blocked, onStart, onBattle, onSettingsOpen, onScreenChange, sound, onSoundChange, wiiCursor, onWiiCursorChange, showFlock, onShowFlockChange };

  const m = menu.current;
  const go = (screen) => {
    if (screen === m.next) return;
    m.next = screen;
    // A keyboard cursor starts over on the next screen.
    if (ui.pointerKind === 'key') ui.pointer = null;
  };
  const live = () => props.current.visible && !props.current.blocked && m.alpha > 0.3 && m.screen === m.next;
  const setSound = (patch) => {
    const { sound: cur, onSoundChange: cb } = props.current;
    cb?.({ ...cur, ...patch });
  };

  const ui = useCanvasUI({
    priority: 2,
    // Input goes to the visible screen as soon as it is fading in (never mid swap-out).
    active: live,
    keyNav: true,
    widgets: () => WIDGETS[m.screen],
    onDrag: (wdg, p) => {
      const v = sliderValue(p.x);
      // A soft tick every 10%, like a notched dial.
      if (Math.round(v * 10) !== Math.round((props.current.sound?.[wdg.id] ?? 0) * 10)) playUISound('tick');
      setSound({ [wdg.id]: v });
    },
    onActivate: (wdg, s) => {
      if (wdg.toggle) {
        const on = !wdg.toggle.on(props.current);
        playUISound(on ? 'toggleOn' : 'toggleOff');
        if (wdg.id === 'wiiCursor') props.current.onWiiCursorChange?.(on);
        else if (wdg.id === 'showFlock') props.current.onShowFlockChange?.(on);
        else setSound({ [wdg.id]: on });
        s.invalidate();
        return;
      }
      switch (wdg.id) {
        case 'start': go('players'); break;
        case 'battle': props.current.onBattle?.(); break;
        case 'settings': m.spin += Math.PI / 2; go('settings'); props.current.onSettingsOpen?.(); break;
        case 'back': go(PARENT[m.screen]); break;
        case 'one': props.current.onStart?.(1); break;
        case 'two': props.current.onStart?.(2); break;
        default:
      }
      s.invalidate();
    },
    onKey: (e, s) => {
      if (e.key === 'Escape' && !e.repeat && live() && PARENT[m.screen]) { playUISound('back'); go(PARENT[m.screen]); s.invalidate(); }
    },
    onBack: (s) => {
      if (!PARENT[m.screen]) return false;
      go(PARENT[m.screen]);
      s.invalidate();
      return true;
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
      const p = props.current;
      if (p.sound !== m.drawnSound || p.wiiCursor !== m.drawnWii || p.showFlock !== m.drawnFlock) s.invalidate();
      if (m.screen !== m.reported) { m.reported = m.screen; props.current.onScreenChange?.(m.screen); }
      const { dataset } = gl.domElement;
      dataset.menuScreen = m.screen;
      dataset.menuReady = String(shown && m.alpha > 0.5 && m.screen === m.next && m.swap > 0.95);
    },
    opacity: () => m.alpha,
    draw: (g, s) => {
      m.drawnSound = props.current.sound;
      m.drawnWii = props.current.wiiCursor;
      m.drawnFlock = props.current.showFlock;
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
      } else if (m.screen === 'players') {
        drawHeader(g, BACK, 'PLAYERS', h.back ?? 0);
        // Each pill shows the Wii-remote LEDs the players will get.
        [[ONE_PLAYER, 'one', 'One Player', 'solo', [1]], [TWO_PLAYERS, 'two', 'Two Players', 'pair', [1, 2]]].forEach(([rect, id, label, icon, leds]) => {
          const hv = h[id] ?? 0;
          drawPill(g, rect, { label, icon, hover: hv, press: press(id) });
          drawPlayerLeds(g, rect.x + rect.w - 92, rect.y + rect.h / 2 - hv * 3 + press(id) * 3, { player: leds, glow: 0.4 + hv * 0.6, scale: 0.55 });
        });
      } else {
        drawHeader(g, BACK, 'SETTINGS', h.back ?? 0);
        drawSettingsPanel(g, props.current, h);
      }
      g.restore();
    },
  });

  // Reopening the menu lands on initialScreen (Back from Song Select returns to players).
  useEffect(() => {
    if (!visible) return;
    m.screen = m.next = initialScreen;
    m.swap = 1;
    ui.invalidate();
  }, [visible, initialScreen, m, ui]);

  return <RemoteDock wiiCursor={wiiCursor} visible={() => props.current.visible && !props.current.blocked && m.screen === 'main' && m.next === 'main'} />;
}
