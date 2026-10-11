// One-of-a-kind 2D trophy art: a glass trophy cup on a podium, drawn as SVG. The look is
// seeded by the battle id (stage, glass color, cup shape, finish) and the winning dance
// (bubbles from pops, sparkles from flair, a golden aura for great sync), so a trophy
// always renders the same.
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
const AURA_SYNC = 0.7;

// Cup bowls all end at the stem (500, 602). inside: the box the bowl's bubbles float in.
const CLASSIC = {
  bowl: 'M335 300C335 470 420 590 500 602C580 590 665 470 665 300Z',
  rim: [500, 300, 165, 30],
  handles: ['M343 345C250 330 245 470 392 520', 'M657 345C750 330 755 470 608 520'],
  shine: 'M368 322C370 430 405 515 452 562',
  inside: [345, 315, 655, 590],
};
const CUPS = {
  Classic: CLASSIC,
  Goblet: {
    bowl: 'M375 258C370 420 440 575 500 602C560 575 630 420 625 258Z',
    rim: [500, 258, 125, 24],
    handles: [],
    shine: 'M398 280C398 410 430 510 470 568',
    inside: [380, 272, 620, 590],
  },
  Orb: {
    bowl: 'M342 440A158 158 0 1 0 658 440A158 158 0 1 0 342 440Z',
    rim: null,
    handles: [],
    shine: 'M372 400A130 130 0 0 1 452 304',
    inside: [350, 290, 650, 590],
  },
  Star: { ...CLASSIC, star: true },
};

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
  const cup = pick(rand, Object.keys(CUPS));
  const roll = rand();
  const finish = roll < 0.08 ? 'Rainbow' : roll < 0.3 ? 'Chrome' : 'Glass';
  return { stage, glass: finish === 'Rainbow' ? 'Prism' : glass, hue, cup, finish, aura: (b.sync ?? 0) >= AURA_SYNC };
}

const f = (n) => Math.round(n * 10) / 10;
const esc = (s) => String(s).replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

function glassStops({ hue, finish }) {
  if (finish === 'Chrome') {
    return [[0, '#ffffff'], [0.4, `hsl(${hue},40%,80%)`], [0.8, `hsl(${hue},38%,42%)`], [1, `hsl(${hue},40%,22%)`]];
  }
  return [[0, `hsl(${hue},100%,95%)`], [0.35, `hsl(${hue},85%,72%)`], [0.8, `hsl(${hue},75%,48%)`], [1, `hsl(${hue},80%,30%)`]];
}
const stops = (list) => list.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('');

const sparkle = (x, y, s) =>
  `<path d="M${f(x)} ${f(y - s)}Q${f(x)} ${f(y)} ${f(x + s)} ${f(y)}Q${f(x)} ${f(y)} ${f(x)} ${f(y + s)}Q${f(x)} ${f(y)} ${f(x - s)} ${f(y)}Q${f(x)} ${f(y)} ${f(x)} ${f(y - s)}Z" fill="#fff"/>`;
const bubbleAt = (x, y, r, tint) =>
  `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="url(#bubble)" stroke="hsl(${tint},100%,88%)" stroke-opacity="0.6" stroke-width="2"/>`
  + `<ellipse cx="${f(x - r * 0.35)}" cy="${f(y - r * 0.4)}" rx="${f(r * 0.28)}" ry="${f(r * 0.15)}" fill="#fff" opacity="0.7"/>`;
function starPath(cx, cy, outer, inner) {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    return `${f(cx + r * Math.cos(a))},${f(cy + r * Math.sin(a))}`;
  });
  return `M${pts.join('L')}Z`;
}

// b: { id, score, pops, sync, flair, created_at }
export function trophySvg(b) {
  const t = trophyTraits(b);
  const cup = CUPS[t.cup];
  const rand = seeded(b.id, 'layout');
  const { stage, hue } = t;
  const font = 'Inter, Helvetica Neue, Helvetica, Arial, sans-serif';

  const rays = Array.from({ length: 7 }, () => {
    const a = (rand() * 100 - 50) * (Math.PI / 180);
    const w = (2 + rand() * 4) * (Math.PI / 180);
    const p = (ang) => `${f(500 + Math.sin(ang) * 1500)},${f(-80 + Math.cos(ang) * 1500)}`;
    return `<polygon points="500,-80 ${p(a - w)} ${p(a + w)}" fill="#fff" opacity="${f(0.06 + rand() * 0.1)}"/>`;
  }).join('');

  // Background bubbles stay below the title strip; a few small ones float in front.
  const bubble = (front) => {
    const r = front ? 8 + rand() * 14 : 12 + rand() * 46;
    return bubbleAt(40 + rand() * 920, 160 + rand() * 590, r, Math.floor(rand() * 360));
  };
  const backBubbles = Array.from({ length: Math.min(40, 8 + Math.round((b.pops ?? 0) * 0.6)) }, () => bubble(false)).join('');
  const frontBubbles = Array.from({ length: 4 }, () => bubble(true)).join('');
  const sparkles = Array.from({ length: Math.min(16, 3 + Math.round((b.flair ?? 0) / 7)) }, () =>
    sparkle(60 + rand() * 880, 170 + rand() * 540, 10 + rand() * 18)).join('');

  // Fizz inside the glass bowl, clipped to it.
  const [x0, y0, x1, y1] = cup.inside;
  const fizz = Array.from({ length: Math.min(14, 4 + Math.round((b.pops ?? 0) / 5)) }, () =>
    bubbleAt(x0 + rand() * (x1 - x0), y0 + rand() * (y1 - y0), 5 + rand() * 14, Math.floor(rand() * 360))).join('')
    + Array.from({ length: 5 }, () => sparkle(x0 + rand() * (x1 - x0), y0 + rand() * (y1 - y0), 6 + rand() * 12)).join('');

  const glassFill = t.finish === 'Rainbow'
    ? `<linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">${stops([0, 60, 130, 200, 270, 330].map((h, i) => [f(i / 5), `hsl(${h},90%,68%)`]))}</linearGradient>`
    : `<radialGradient id="glass" cx="0.38" cy="0.32" r="0.8">${stops(glassStops(t))}</radialGradient>`;
  const sat = t.finish === 'Chrome' ? 28 : 40;
  const metal = stops([
    [0, `hsl(${hue},${sat}%,28%)`], [0.3, `hsl(${hue},${sat}%,74%)`], [0.42, '#ffffff'],
    [0.62, `hsl(${hue},${sat}%,58%)`], [1, `hsl(${hue},${sat}%,26%)`],
  ]);
  const inner = t.finish === 'Rainbow' ? 'hsl(270,60%,28%)' : `hsl(${hue},70%,24%)`;

  const handles = cup.handles.map((d) =>
    `<path d="${d}" fill="none" stroke="url(#metal)" stroke-width="22" stroke-linecap="round"/>`
    + `<path d="${d}" fill="none" stroke="#fff" stroke-opacity="0.55" stroke-width="5" stroke-linecap="round"/>`).join('');
  const rim = cup.rim
    ? `<ellipse cx="${cup.rim[0]}" cy="${cup.rim[1]}" rx="${cup.rim[2]}" ry="${cup.rim[3]}" fill="${inner}" fill-opacity="0.6" stroke="#fff" stroke-opacity="0.85" stroke-width="5"/>`
    : '';
  const star = cup.star
    ? `<rect x="493" y="230" width="14" height="60" rx="5" fill="url(#metal)"/><path d="${starPath(500, 196, 70, 30)}" fill="url(#glass)" stroke="#fff" stroke-opacity="0.85" stroke-width="4" stroke-linejoin="round" filter="url(#glow)"/>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${stage.sky[0]}"/><stop offset="1" stop-color="${stage.sky[1]}"/></linearGradient>
<radialGradient id="sun" cx="0.5" cy="0.4" r="0.45"><stop offset="0" stop-color="#fff" stop-opacity="0.6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<radialGradient id="aura" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffd84a" stop-opacity="0.75"/><stop offset="0.6" stop-color="#ffc83d" stop-opacity="0.25"/><stop offset="1" stop-color="#ffc83d" stop-opacity="0"/></radialGradient>
<linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="0.25" stop-color="${stage.floor}"/><stop offset="1" stop-color="${stage.floor}" stop-opacity="0.6"/></linearGradient>
<radialGradient id="bubble" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.75" stop-color="#fff" stop-opacity="0.08"/><stop offset="0.93" stop-color="#fff" stop-opacity="0.4"/><stop offset="1" stop-color="#fff" stop-opacity="0.75"/></radialGradient>
${glassFill}
<linearGradient id="metal" x1="0" y1="0" x2="1" y2="0">${metal}</linearGradient>
<linearGradient id="podium" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${stage.podium}"/><stop offset="1" stop-color="#000" stop-opacity="0.35"/></linearGradient>
<linearGradient id="podiumTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.85"/><stop offset="1" stop-color="${stage.podium}"/></linearGradient>
<clipPath id="bowl"><path d="${cup.bowl}"/></clipPath>
<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#00224a" flood-opacity="0.55"/></filter>
</defs>
<rect width="1000" height="1000" fill="url(#sky)"/>
${rays}
<rect width="1000" height="1000" fill="url(#sun)"/>
<ellipse cx="500" cy="1010" rx="820" ry="270" fill="url(#floor)"/>
${backBubbles}
<g filter="url(#glow)">${sparkles}</g>
${t.aura ? '<circle cx="500" cy="450" r="330" fill="url(#aura)"/>' : ''}
<path d="M270 800V900A230 46 0 0 0 730 900V800Z" fill="url(#podium)"/>
<ellipse cx="500" cy="800" rx="230" ry="46" fill="url(#podiumTop)"/>
<path d="M285 812Q500 860 715 812" stroke="#fff" stroke-opacity="0.5" stroke-width="4" fill="none"/>
<path d="M405 792L418 722H582L595 792Z" fill="url(#metal)"/>
<ellipse cx="500" cy="792" rx="95" ry="12" fill="url(#metal)"/>
<ellipse cx="500" cy="722" rx="82" ry="13" fill="hsl(${hue},${sat}%,86%)"/>
<rect x="446" y="744" width="108" height="30" rx="7" fill="#fff" fill-opacity="0.4"/>
<text x="500" y="766" font-family="${font}" font-size="17" font-weight="800" text-anchor="middle" letter-spacing="3" fill="hsl(${hue},45%,22%)">WINNER</text>
<path d="M478 722C478 690 490 660 490 612H510C510 660 522 690 522 722Z" fill="url(#metal)"/>
<ellipse cx="500" cy="652" rx="25" ry="10" fill="url(#metal)"/>
<ellipse cx="500" cy="606" rx="36" ry="9" fill="url(#metal)"/>
${star}
${handles}
<path d="${cup.bowl}" fill="url(#glass)" fill-opacity="0.85"/>
<g clip-path="url(#bowl)">${fizz}</g>
<path d="${cup.bowl}" fill="none" stroke="#fff" stroke-opacity="0.6" stroke-width="4"/>
<path d="${cup.shine}" fill="none" stroke="#fff" stroke-opacity="0.6" stroke-width="16" stroke-linecap="round"/>
${rim}
${frontBubbles}
<g font-family="${font}" fill="#fff" filter="url(#shadow)">
<text x="56" y="104" font-size="60" letter-spacing="-2"><tspan font-weight="800">aero</tspan><tspan font-weight="200">dance.</tspan></text>
<text x="944" y="100" font-size="34" font-weight="700" text-anchor="end">#${esc(b.id)}</text>
<text x="500" y="870" font-size="44" font-weight="800" text-anchor="middle" letter-spacing="2">${esc(b.score ?? 0)}</text>
<text x="500" y="962" font-size="26" font-weight="600" text-anchor="middle" opacity="0.95">${esc(`${t.stage.name} · ${t.glass} ${t.finish === 'Glass' ? 'glass' : t.finish.toLowerCase()} ${t.cup.toLowerCase()} · ${b.created_at.toISOString().slice(0, 10)}`)}</text>
</g>
</svg>`;
}
