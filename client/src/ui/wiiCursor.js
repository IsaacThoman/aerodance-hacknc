// The Wii remote's player-1 pointer: the white pointing hand with a blue "1" on its cuff,
// redrawn from the Wii Menu's 43x62 sprite. Shapes are in Wii framebuffer pixels; the hotspot
// is the fingertip.

// One Wii framebuffer pixel in design units. The display renders into a fixed 640x480 buffer
// stretched to 16:9, as a Wii does in widescreen, so the 900 design units span the Wii's 480
// lines: the hand comes out 62 buffer pixels tall, the same share of the screen as on a Wii.
export const WII_PX = 900 / 480;

const HOTSPOT = { x: 13, y: 1 };
const OUTLINE = 3.4;
// Dropped down and to the right, like the Wii's cursor shadow.
const SHADOW = { x: 1, y: 2, blur: 1, color: 'rgba(0, 0, 0, 0.35)' };

let paths = null;

// Arc on circle (cx, cy, r) from point a to point b, clockwise on screen.
const arcBetween = (p, cx, cy, r, a, b) =>
  p.arc(cx, cy, r, Math.atan2(a[1] - cy, a[0] - cx), Math.atan2(b[1] - cy, b[0] - cx));

function buildPaths() {
  // The centre line of the outline, clockwise from the left of the fingertip.
  const hand = new Path2D();
  hand.moveTo(8.15, 7.5);
  hand.arc(13.15, 7.5, 5, Math.PI, 0);
  hand.lineTo(18.15, 22.03);
  // Knuckles of the curled fingers, meeting in little valleys.
  arcBetween(hand, 21.6, 25.3, 4.75, [18.15, 22.03], [25.87, 23.23]);
  arcBetween(hand, 29, 26.8, 4.75, [25.87, 23.23], [33.45, 25.14]);
  arcBetween(hand, 36, 28.6, 4.3, [33.45, 25.14], [40.3, 28.6]);
  // Down the side, tapering into the wrist.
  hand.lineTo(40.3, 45.5);
  hand.bezierCurveTo(40.3, 49.5, 35.85, 50.5, 35.85, 55);
  hand.arcTo(35.85, 59.35, 11.8, 59.35, 1.5);
  hand.arcTo(11.8, 59.35, 11.8, 55, 1.5);
  hand.lineTo(11.8, 55);
  hand.bezierCurveTo(11.8, 50, 2, 49, 2, 44);
  // Up and over the thumb, back into the finger.
  hand.lineTo(2, 34);
  hand.bezierCurveTo(2, 31.5, 5, 28.3, 8.15, 28.3);
  hand.closePath();

  const fingers = new Path2D();
  fingers.moveTo(17.6, 21.6);
  fingers.lineTo(17.6, 28.4);
  fingers.moveTo(25.6, 23.6);
  fingers.lineTo(25.5, 28.4);
  fingers.moveTo(33.1, 25.6);
  fingers.lineTo(32.8, 28.4);

  const thumb = new Path2D();
  thumb.moveTo(8.1, 28.4);
  thumb.lineTo(8.7, 35.6);

  // Shade inside the right-hand edges.
  const shade = new Path2D();
  shade.moveTo(16, 6);
  shade.lineTo(16, 28.6);
  shade.moveTo(38.1, 29);
  shade.lineTo(38.1, 45);

  const one = new Path2D();
  one.moveTo(19.4, 31.4);
  one.lineTo(26, 31.4);
  one.lineTo(26, 48.8);
  one.lineTo(22, 48.8);
  one.lineTo(22, 35.8);
  one.lineTo(19.4, 35.8);
  one.closePath();

  return { hand, fingers, thumb, shade, one };
}

// The pointer with its fingertip at (x, y), in design units.
export function drawWiiCursor(g, { x, y }) {
  paths ??= buildPaths();
  const { hand, fingers, thumb, shade, one } = paths;
  g.save();
  g.translate(x, y);
  g.scale(WII_PX, WII_PX);
  g.translate(-HOTSPOT.x, -HOTSPOT.y);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.lineWidth = OUTLINE;

  // Shadow first: the silhouette casts it and is then painted over. Shadow offsets ignore the
  // transform, so scale them to buffer pixels.
  const m = g.getTransform();
  g.shadowColor = SHADOW.color;
  g.shadowOffsetX = SHADOW.x * m.a;
  g.shadowOffsetY = SHADOW.y * m.d;
  g.shadowBlur = SHADOW.blur;
  g.fillStyle = g.strokeStyle = '#000000';
  g.fill(hand);
  g.stroke(hand);
  g.shadowColor = 'transparent';

  // White hand, pale blue cuff below the knuckle line.
  g.fillStyle = '#ffffff';
  g.fill(hand);
  g.save();
  g.clip(hand);
  const cuff = g.createLinearGradient(0, 36, 0, 58);
  cuff.addColorStop(0, '#ddf0ff');
  cuff.addColorStop(0.36, '#a1d5ff');
  cuff.addColorStop(1, '#8acbff');
  g.fillStyle = cuff;
  g.fillRect(0, 36, 43, 26);
  g.lineWidth = 1;
  g.lineCap = 'butt';
  g.strokeStyle = 'rgba(0, 40, 60, 0.2)';
  g.stroke(shade);
  g.restore();

  g.fillStyle = '#0089ff';
  g.fill(one);

  g.strokeStyle = '#000000';
  g.lineWidth = 1.2;
  g.stroke(fingers);
  g.lineWidth = 1.8;
  g.stroke(thumb);
  g.lineWidth = OUTLINE;
  g.stroke(hand);
  g.restore();
}
