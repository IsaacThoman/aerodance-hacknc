import { useRef } from 'react';
import { ICONS, drawGlassCircle, drawShadowText } from '../ui/draw.js';
import useCanvasUI from '../ui/useCanvasUI.js';
import useFullscreen from './useFullscreen.js';

/**
 * The main menu's fullscreen bubble, drawn in-engine in the bottom-right corner (priority
 * 3.5). It slides off to the right outside the main menu and back in on return. Click it on
 * the display itself: browsers only enter fullscreen from the user's own input.
 *
 * <FullscreenButton visible={() => isMainScreen} />
 */

const BUTTON = { x: 1516, y: 836, r: 42 };
const SLIDE_SECONDS = 0.3;

const smooth = (k) => k * k * (3 - 2 * k);

export default function FullscreenButton({ visible = () => true }) {
  const fullscreen = useFullscreen();
  const props = useRef({});
  props.current = { fullscreen, visible };
  const st = useRef({ slide: 0, visible: null, drawn: null }).current;

  useCanvasUI({
    priority: 3.5,
    active: () => props.current.visible() && st.slide === 0,
    widgets: () => (props.current.fullscreen.supported ? [{ id: 'fullscreen', circle: BUTTON }] : []),
    onActivate: (_wdg, s) => {
      props.current.fullscreen.toggle();
      s.invalidate();
    },
    update: (dt, s) => {
      const shown = props.current.visible();
      if (shown !== st.visible) { st.visible = shown; s.invalidate(); }
      const slide = Math.max(0, Math.min(1, st.slide + (shown ? -1 : 1) * dt / SLIDE_SECONDS));
      if (slide !== st.slide) { st.slide = slide; s.invalidate(); }
      if (props.current.fullscreen !== st.drawn) s.invalidate();
    },
    opacity: () => (st.slide === 1 ? 0 : 1),
    draw: (g, s) => {
      const fs = props.current.fullscreen;
      st.drawn = fs;
      // Keep the bubble opaque while it travels beyond the frame's right edge.
      g.save();
      g.translate(smooth(st.slide) * (s.w - BUTTON.x + BUTTON.r + 24), 0);
      if (!fs.supported) g.globalAlpha *= 0.5;
      drawGlassCircle(g, BUTTON, s.hover.fullscreen ?? 0);
      g.lineWidth = 4;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.strokeStyle = '#ffffff';
      ICONS.fullscreen(g, BUTTON.x, BUTTON.y, BUTTON.r, fs.active);
      g.restore();
      if (st.visible && fs.error) {
        drawShadowText(g, fs.error, BUTTON.x - BUTTON.r - 18, BUTTON.y, { size: 24, align: 'right' });
      }
    },
  });

  return null;
}
