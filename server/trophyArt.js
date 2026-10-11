// One-of-a-kind 2D trophy art: the glass aero dancer on a podium, drawn as SVG. The look is
// seeded by the battle id (stage, glass color, pose, finish) and the winning dance (bubbles
// from pops, sparkles from flair, a halo for great sync), so a trophy always renders the same.
import { createHash } from 'node:crypto';

const STAGES = [
  { name: 'Skyline Sanctuary', sky: ['#4dbdff', '#e6f7ff'], floor: '#a9defa', podium: '#2f8fd8' },
  { name: 'Coral Dome', sky: ['#17aab4', '#d2fbf3'], floor: '#78dccb', podium: '#ff8a65' },
  { name: 'Open Reef', sky: ['#064f8f', '#4fc1ee'], floor: '#2a8fd0', podium: '#ffb938' },
  { name: 'Emerald Falls', sky: ['#2fb257', '#e0fbe3'], floor: '#94e39c', podium: '#1f8f52' },
  { name: 'Club Aquarium', sky: ['#120e3a', '#5b2a94'], floor: '#3a2878', podium: '#b45cff' },
  { name: 'Sugarsand Sunset', sky: ['#ff7a59', '#ffe2a0'], floor: '#ffd08f', podium: '#ff5f8a' },
];
const GLASS = [['Aqua', 188], ['Azure', 212], ['Violet', 272], ['Rose', 328], ['Lime', 96], ['Gold', 44], ['Mint', 158]];
// Where the floating hands sit, relative to the shoulders, at the dance capture's big moments.
const POSES = {
  'Hands Up': [[-175, -225], [175, -225]],
  'Wide Arms': [[-190, 20], [190, 20]],
  Reach: [[-160, 60], [180, -215]],
  Lunge: [[-185, -60], [150, 120]],
  Victory: [[-175, -215], [185, 40]],
};
const HALO_SYNC = 0.7;

// Deterministic stream of [0, 1) numbers for a battle (mulberry32 seeded by sha256).
function seeded(id, stream) {
  let a = createHash('sha256').update(`aerodance-trophy:${stream}:${id}`).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rand, xs) => xs[Math.floor(rand() * xs.length)];

// The trophy's traits, shared by its image and its NFT attributes.
export function trophyTraits(b) {
  const rand = seeded(b.id, 'traits');
  const stage = pick(rand, STAGES);
  const [glass, hue] = pick(rand, GLASS);
  const pose = pick(rand, Object.keys(POSES));
  const roll = rand();
  const finish = roll < 0.08 ? 'Rainbow' : roll < 0.3 ? 'Chrome' : 'Glass';
  return { stage, glass: finish === 'Rainbow' ? 'Prism' : glass, hue, pose, finish, halo: (b.sync ?? 0) >= HALO_SYNC };
}

const f = (n) => Math.round(n * 10) / 10;
const esc = (s) => String(s).replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

function glassStops({ hue, finish }) {
  if (finish === 'Chrome') {
    return [[0, '#ffffff'], [0.4, `hsl(${hue},18%,80%)`], [0.8, `hsl(${hue},22%,42%)`], [1, `hsl(${hue},28%,22%)`]];
  }
  return [[0, `hsl(${hue},100%,95%)`], [0.35, `hsl(${hue},85%,72%)`], [0.8, `hsl(${hue},75%,48%)`], [1, `hsl(${hue},80%,30%)`]];
}
const stops = (list, opacity = 1) =>
  list.map(([o, c]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${opacity}"/>`).join('');

// A glossy highlight on the upper left of a round shape.
const shine = (cx, cy, r) =>
  `<ellipse cx="${f(cx - r * 0.36)}" cy="${f(cy - r * 0.44)}" rx="${f(r * 0.34)}" ry="${f(r * 0.18)}" transform="rotate(-32 ${f(cx - r * 0.36)} ${f(cy - r * 0.44)})" fill="#fff" opacity="0.8"/>`;
const ball = (cx, cy, r) =>
  `<circle cx="${f(cx)}" cy="${f(cy)}" r="${r}" fill="url(#glass)" stroke="url(#rim)" stroke-width="3"/>${shine(cx, cy, r)}`;
const star = (x, y, s) =>
  `<path d="M${f(x)} ${f(y - s)}Q${f(x)} ${f(y)} ${f(x + s)} ${f(y)}Q${f(x)} ${f(y)} ${f(x)} ${f(y + s)}Q${f(x)} ${f(y)} ${f(x - s)} ${f(y)}Q${f(x)} ${f(y)} ${f(x)} ${f(y - s)}Z" fill="#fff"/>`;

// b: { id, score, pops, sync, flair, dancers, created_at }
export function trophySvg(b) {
  const t = trophyTraits(b);
  const rand = seeded(b.id, 'layout');
  const { stage } = t;
  const font = 'Inter, Helvetica Neue, Helvetica, Arial, sans-serif';

  const rays = Array.from({ length: 7 }, () => {
    const a = (rand() * 100 - 50) * (Math.PI / 180);
    const w = (2 + rand() * 4) * (Math.PI / 180);
    const p = (ang) => `${f(500 + Math.sin(ang) * 1500)},${f(-80 + Math.cos(ang) * 1500)}`;
    return `<polygon points="500,-80 ${p(a - w)} ${p(a + w)}" fill="#fff" opacity="${f(0.06 + rand() * 0.1)}"/>`;
  }).join('');

  const bubble = (front) => {
    const r = front ? 8 + rand() * 14 : 12 + rand() * 46;
    const x = 40 + rand() * 920;
    const y = 160 + rand() * 590; // below the title strip
    const tint = Math.floor(rand() * 360);
    return `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="url(#bubble)" stroke="hsl(${tint},100%,88%)" stroke-opacity="0.6" stroke-width="2"/>`
      + `<ellipse cx="${f(x - r * 0.35)}" cy="${f(y - r * 0.4)}" rx="${f(r * 0.28)}" ry="${f(r * 0.15)}" fill="#fff" opacity="0.7"/>`;
  };
  const backBubbles = Array.from({ length: Math.min(40, 8 + Math.round((b.pops ?? 0) * 0.6)) }, () => bubble(false)).join('');
  const frontBubbles = Array.from({ length: 4 }, () => bubble(true)).join('');

  const sparkles = Array.from({ length: Math.min(16, 3 + Math.round((b.flair ?? 0) / 7)) }, () =>
    star(60 + rand() * 880, 170 + rand() * 540, 10 + rand() * 18)).join('');

  // The dancer: head at (500, 400), shoulders at (500, 560), standing on the podium.
  const tilt = f(rand() * 16 - 8);
  const [[lx, ly], [rx, ry]] = POSES[t.pose];
  const glassFill = t.finish === 'Rainbow'
    ? `<linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">${stops([0, 60, 130, 200, 270, 330].map((h, i) => [f(i / 5), `hsl(${h},90%,68%)`]))}</linearGradient>`
    : `<radialGradient id="glass" cx="0.38" cy="0.32" r="0.75">${stops(glassStops(t))}</radialGradient>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${stage.sky[0]}"/><stop offset="1" stop-color="${stage.sky[1]}"/></linearGradient>
<radialGradient id="sun" cx="0.5" cy="0.38" r="0.45"><stop offset="0" stop-color="#fff" stop-opacity="0.6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="0.25" stop-color="${stage.floor}"/><stop offset="1" stop-color="${stage.floor}" stop-opacity="0.6"/></linearGradient>
<radialGradient id="bubble" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.75" stop-color="#fff" stop-opacity="0.08"/><stop offset="0.93" stop-color="#fff" stop-opacity="0.4"/><stop offset="1" stop-color="#fff" stop-opacity="0.75"/></radialGradient>
${glassFill}
<linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.9"/><stop offset="1" stop-color="#fff" stop-opacity="0.2"/></linearGradient>
<linearGradient id="podium" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${stage.podium}"/><stop offset="1" stop-color="#000" stop-opacity="0.35"/></linearGradient>
<linearGradient id="podiumTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.85"/><stop offset="1" stop-color="${stage.podium}"/></linearGradient>
<linearGradient id="halo" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff2a8"/><stop offset="0.5" stop-color="#ffc83d"/><stop offset="1" stop-color="#fff2a8"/></linearGradient>
<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#00224a" flood-opacity="0.55"/></filter>
</defs>
<rect width="1000" height="1000" fill="url(#sky)"/>
${rays}
<rect width="1000" height="1000" fill="url(#sun)"/>
<ellipse cx="500" cy="1010" rx="820" ry="270" fill="url(#floor)"/>
${backBubbles}
<g filter="url(#glow)">${sparkles}</g>
<path d="M270 800V900A230 46 0 0 0 730 900V800Z" fill="url(#podium)"/>
<ellipse cx="500" cy="800" rx="230" ry="46" fill="url(#podiumTop)"/>
<path d="M285 812Q500 860 715 812" stroke="#fff" stroke-opacity="0.5" stroke-width="4" fill="none"/>
<g opacity="0.94">
<ellipse cx="450" cy="782" rx="56" ry="30" fill="url(#glass)" stroke="url(#rim)" stroke-width="3"/>
<ellipse cx="550" cy="782" rx="56" ry="30" fill="url(#glass)" stroke="url(#rim)" stroke-width="3"/>
<path d="M422 772C405 650 428 518 500 504C572 518 595 650 578 772Q500 796 422 772Z" fill="url(#glass)" stroke="url(#rim)" stroke-width="3"/>
<ellipse cx="462" cy="580" rx="20" ry="58" fill="#fff" opacity="0.45"/>
<g transform="rotate(${tilt} 500 500)">
${t.halo ? '<ellipse cx="500" cy="282" rx="76" ry="17" fill="none" stroke="url(#halo)" stroke-width="9" filter="url(#glow)"/>' : ''}
${ball(500, 400, 100)}
<ellipse cx="466" cy="404" rx="12" ry="22" fill="#14203d"/><ellipse cx="534" cy="404" rx="12" ry="22" fill="#14203d"/>
<circle cx="469" cy="394" r="4" fill="#fff"/><circle cx="537" cy="394" r="4" fill="#fff"/>
</g>
${ball(500 + lx, 560 + ly, 44)}
${ball(500 + rx, 560 + ry, 44)}
</g>
${frontBubbles}
<g font-family="${font}" fill="#fff" filter="url(#shadow)">
<text x="56" y="104" font-size="60" letter-spacing="-2"><tspan font-weight="800">aero</tspan><tspan font-weight="200">dance.</tspan></text>
<text x="944" y="100" font-size="34" font-weight="700" text-anchor="end">#${esc(b.id)}</text>
<text x="500" y="870" font-size="44" font-weight="800" text-anchor="middle" letter-spacing="2">${esc(b.score ?? 0)}</text>
<text x="500" y="962" font-size="26" font-weight="600" text-anchor="middle" opacity="0.95">${esc(`${t.stage.name} · ${t.glass} ${t.finish === 'Glass' ? 'glass' : t.finish.toLowerCase()} · ${b.created_at.toISOString().slice(0, 10)}`)}</text>
</g>
</svg>`;
}
