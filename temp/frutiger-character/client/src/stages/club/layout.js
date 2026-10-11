// Room layout. Angles are three.js cylinder thetas (0 = +z, PI = -z, back wall).
const D = Math.PI / 180;

export const ROOM_R = 13.6;
export const CEILING = 10;
export const FLOOR = -1.05;

// Video wall spans the back, aquariums wrap the back corners on both sides.
export const SCREEN = { r: 12.7, theta: Math.PI - 31 * D, length: 62 * D, y0: 3.3, y1: 9.6 };
export const TANK = { glass: 13.6, back: 16.4, half: 21 * D, y0: FLOOR, y1: CEILING };
export const TANK_CENTERS = [Math.PI + 58 * D, Math.PI - 58 * D];
export const PILLARS = [Math.PI + 81 * D, Math.PI - 81 * D];
// Glass bubble columns flanking the video wall.
export const COLUMNS = [Math.PI + 35 * D, Math.PI - 35 * D];

export const polar = (r, theta, y = 0) => [r * Math.sin(theta), y, r * Math.cos(theta)];
