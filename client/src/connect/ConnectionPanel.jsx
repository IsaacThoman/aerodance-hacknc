import { useRef } from 'react';
import { useThree } from '@react-three/fiber';
import {
  FONT, ICONS, drawCaps, drawGlassCircle, drawGlassPanel, drawPill, drawStatusDot, ellipsize, paragraph, text,
} from '../ui/draw.js';
import useCanvasUI from '../ui/useCanvasUI.js';
import { CARD, CLOSE, COLUMN, PILL, PRIMARY, STATUS, CAMERA_PREV, CAMERA_NEXT, MODEL_RECTS, WEBCAM_PREVIEW } from './layout.js';
import { MODELS } from '../../../packages/pose/browser/models.js';
import { drawWebcamPreview } from '../../../packages/pose/browser/preview.js';

/**
 * Connect Client, drawn in-engine: a status pill in the top-right corner of Settings
 * opens a card for the webcam pose input. It runs the chosen MediaPipe model locally and
 * previews player placement in the card.
 *
 * While the card is open the rest of the menus are held (App passes them `blocked`).
 * The canvas reports data-connect-open / -ready / -status / -message / -model / -camera for tests.
 *
 * <ConnectionPanel visible open onOpenChange={setOpen} source={source} connection={view} />
 */

const ACTIVE = ['connecting', 'initializing', 'connected'];
const LABELS = {
  connected: 'Client Connected',
  connecting: 'Connecting…',
  initializing: 'Camera starting…',
};
const smooth = (k) => k * k * (3 - 2 * k);

export default function ConnectionPanel({ visible = true, open = false, onOpenChange, source, connection }) {
  const gl = useThree((state) => state.gl);
  const props = useRef({});
  props.current = { visible, open, onOpenChange, source, connection };
  // alpha: the whole overlay; k: how far the card is out (it grows from the pill).
  const st = useRef({ alpha: 0, k: 0, error: '', drawn: null }).current;

  const connecting = () => ACTIVE.includes(props.current.connection.status);
  const message = () => st.error || props.current.connection.message || '';
  const close = () => props.current.onOpenChange?.(false);
  const submit = () => {
    const p = props.current;
    if (connecting()) { p.source.disconnect(); return; }
    st.error = '';
    p.source.connect()?.catch(err => { st.error = err.message; });
  };

  useCanvasUI({
    priority: 3.2,
    active: () => props.current.visible && st.alpha > 0.3,
    keyNav: () => props.current.open,
    widgets: () => {
      // The card takes input once it's mostly out (not while it whooshes from the pill).
      if (!props.current.open || st.k < 0.5) return [{ id: 'pill', rect: PILL }];
      return [
        { id: 'close', circle: CLOSE },
        { id: 'camera-prev', rect: CAMERA_PREV, cameraDelta: -1 },
        { id: 'camera-next', rect: CAMERA_NEXT, cameraDelta: 1 },
        ...MODELS.map((model, i) => ({ id: `model-${model.id}`, rect: MODEL_RECTS[i], modelId: model.id })),
        { id: 'primary', rect: PRIMARY },
        { id: 'pill', rect: PILL, nav: false },
      ];
    },
    onActivate: (wdg, s) => {
      const p = props.current;
      if (wdg.id === 'pill') p.onOpenChange?.(!p.open);
      else if (wdg.id === 'close') close();
      else if (wdg.modelId) {
        st.error = ''; void p.source.configure({ modelId: wdg.modelId }).catch(err => { st.error = err.message; });
      } else if (wdg.cameraDelta) {
        const cameras = [{ deviceId: '', label: 'Default camera' }, ...(p.connection.cameras || [])];
        const index = Math.max(0, cameras.findIndex(camera => camera.deviceId === p.connection.cameraId));
        const camera = cameras[(index + wdg.cameraDelta + cameras.length) % cameras.length];
        st.error = ''; void p.source.configure({ cameraId: camera.deviceId }).catch(err => { st.error = err.message; });
      }
      else if (wdg.id === 'primary') submit();
      s.invalidate();
    },
    onKey: (e, s) => {
      const p = props.current;
      if (!p.visible || !p.open || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') { if (!e.repeat) close(); }
      // With the keyboard cursor on a widget, Enter presses that widget instead (keyNav).
      else if (e.key === 'Enter' && s.pointerKind !== 'key') submit();
      else return;
      e.preventDefault();
      s.invalidate();
    },
    update: (_dt, s) => {
      const p = props.current;
      st.alpha = s.ease(st.alpha, p.visible ? 1 : 0, p.visible ? 3 : 6);
      if (!p.visible && p.open) close();
      st.k = s.ease(st.k, p.open && p.visible ? 1 : 0, p.open ? 8 : 10);
      const { status } = p.connection;
      const ready = p.open && st.k >= 0.5 && st.alpha > 0.3;
      if (p.open && p.source.video && s.time - (st.lastPreview || 0) > 1 / 15) {
        st.lastPreview = s.time; s.invalidate();
      }
      const key = `${status}|${message()}|${p.open}|${ready}|${p.connection.model}|${p.connection.cameraId}|${p.connection.cameras?.length}`;
      if (key !== st.drawn) {
        st.drawn = key;
        s.invalidate();
        Object.assign(gl.domElement.dataset, {
          connectOpen: String(p.open), connectReady: String(ready), connectStatus: status, connectMessage: message(),
          connectModel: p.connection.model || '', connectCamera: p.connection.cameraId || '',
        });
      }
    },
    opacity: () => st.alpha,
    draw: (g, s) => {
      const p = props.current;
      const h = s.hover;
      const press = (id) => s.press * (h[id] ?? 0);
      const { status } = p.connection;
      const k = smooth(st.k);

      if (k > 0.01) {
        // Dim the menus behind; they're on hold while the card is out.
        g.fillStyle = `rgba(0, 18, 48, ${0.35 * k})`;
        g.fillRect(0, 0, s.w, s.h);
        g.save();
        g.globalAlpha *= Math.min(1, k * 1.4);
        const ox = PILL.x + PILL.w / 2;
        const oy = PILL.y + PILL.h;
        g.translate(ox, oy);
        g.scale(k, k);
        g.translate(-ox, -oy);
        drawGlassPanel(g, CARD, 30);
        drawCaps(g, 'CONNECT CLIENT', CARD.x + 36, CARD.y + 46, { size: 24 });
        drawGlassCircle(g, CLOSE, h.close ?? 0);
        g.lineWidth = 4;
        g.lineCap = 'round';
        g.strokeStyle = '#ffffff';
        ICONS.close(g, CLOSE.x, CLOSE.y, CLOSE.r * 1.1);

        text(g, 'Camera · use arrows to choose', COLUMN.x + 4, CAMERA_PREV.y - 26, { size: 22, weight: 700, color: '#bff4ff' });
        drawPill(g, CAMERA_PREV, { label: '', icon: 'left', hover: h['camera-prev'] ?? 0 });
        drawPill(g, CAMERA_NEXT, { label: '', icon: 'right', hover: h['camera-next'] ?? 0 });
        const camera = p.connection.cameras?.find(camera => camera.deviceId === p.connection.cameraId);
        g.font = `700 24px ${FONT}`;
        text(g, ellipsize(g, camera?.label || 'Default camera', 470), CARD.x + CARD.w / 2, CAMERA_PREV.y + 29, { size: 24, align: 'center' });
        MODELS.forEach((model, i) => drawPill(g, MODEL_RECTS[i], {
          label: `${p.connection.model === model.id ? '● ' : ''}${model.label}`, icon: 'gear', hover: h[`model-${model.id}`] ?? 0,
        }));
        drawWebcamPreview(g, p.source.video, p.connection.snapshot, WEBCAM_PREVIEW, p.source.playerCount);
        paragraph(g, MODELS.find(model => model.id === p.connection.model)?.description || '',
          WEBCAM_PREVIEW.x + WEBCAM_PREVIEW.w + 20, WEBCAM_PREVIEW.y + 20, 365, { size: 21, lineH: 27 });
        paragraph(g, 'Keep your full body visible. Video stays in this browser. Camera access needs HTTPS or localhost.',
          WEBCAM_PREVIEW.x + WEBCAM_PREVIEW.w + 20, WEBCAM_PREVIEW.y + 78, 365, { size: 19, lineH: 24 });

        paragraph(g, message(), STATUS.x + 4, STATUS.y, STATUS.w - 8, { size: 21, lineH: 28, color: st.error || status === 'error' ? '#ffb38a' : '#ffffff' });

        const active = connecting();
        const label = active ? (status === 'connected' ? 'Disconnect' : 'Cancel connection') : 'Start camera';
        drawPill(g, PRIMARY, { label, icon: active ? 'close' : 'play', hover: h.primary ?? 0, press: press('primary') });
        g.restore();
      }

      // The pill: status light and what the pose input is doing.
      const hv = h.pill ?? 0;
      g.save();
      g.globalAlpha *= 0.88 + hv * 0.12;
      drawGlassPanel(g, PILL, PILL.h / 2);
      g.restore();
      const cy = PILL.y + PILL.h / 2;
      drawStatusDot(g, PILL.x + 40, cy, status, 11);
      g.font = `700 28px ${FONT}`;
      text(g, ellipsize(g, LABELS[status] ?? 'Connect Client', PILL.w - 130), PILL.x + 68, cy + 1, { size: 28, weight: 700 });
      g.lineWidth = 4;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.strokeStyle = '#ffffff';
      (p.open ? ICONS.up : ICONS.down)(g, PILL.x + PILL.w - 38, cy, 40);
    },
  });

  return null;
}
