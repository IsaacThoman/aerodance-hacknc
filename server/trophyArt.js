// One-of-a-kind trophy art in the game's Frutiger Aero look (client/src/ui/draw.js and the
// win screens): a glass trophy on one of the six stages' round glass dance floors, under the
// winner's light column, with the title screen's wordmark and a name-card pill. The look is
// seeded by the battle id (stage, glass colour, trophy shape, finish) and the winning dance
// (bubbles from pops, sparkles from flair, a golden halo for great sync), so a trophy always
// renders the same.
import { createHash } from 'node:crypto';

const NAVY = '#0c2f52';
const MINT = '#6ff3d6';
const FONT = 'Inter, Helvetica Neue, Helvetica, Arial, sans-serif';
const GOLD = ['#fff3b0', '#ffd34d', '#e09a12'];
const AURA_SYNC = 0.7;

// The dance floor: a round glass stage centred at (500, FLOOR_Y), like the stages' own.
const FLOOR_Y = 770;
const PEDESTAL_Y = 712;

const f = (n) => Math.round(n * 10) / 10;
const esc = (s) => String(s).replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ---------- the six stages (names and name-card accents from packages/stages/*/meta.js) ----------

const cloud = (x, y, s) => {
  const puffs = [[0, 0, 58], [52, -26, 70], [118, -4, 56], [62, 14, 60], [-44, 12, 40], [160, 16, 38]];
  const circles = (dy, fill) => puffs.map(([dx, py, r]) =>
    `<circle cx="${f(x + dx * s)}" cy="${f(y + (py + dy) * s)}" r="${f(r * s)}" fill="${fill}"/>`).join('');
  return circles(12, '#c9e2f6') + circles(0, '#ffffff');
};

const turbine = (x, y, s) => {
  const hub = y - 130 * s;
  const blades = [0, 120, 240].map((a) =>
    `<path d="M${f(x)} ${f(hub)}L${f(x - 4 * s)} ${f(hub - 58 * s)}Q${f(x)} ${f(hub - 66 * s)} ${f(x + 4 * s)} ${f(hub - 58 * s)}Z" transform="rotate(${a + 20} ${f(x)} ${f(hub)})"/>`).join('');
  return `<g fill="#ffffff" opacity="0.9"><path d="M${f(x - 2.5 * s)} ${f(y)}L${f(x - 1.2 * s)} ${f(hub)}H${f(x + 1.2 * s)}L${f(x + 2.5 * s)} ${f(y)}Z"/>${blades}<circle cx="${f(x)}" cy="${f(hub)}" r="${f(4 * s)}"/></g>`;
};

const fish = (x, y, s, body, fin, flip = 1) =>
  `<g transform="translate(${f(x)} ${f(y)}) scale(${f(s * flip * 100) / 100} ${f(s * 100) / 100})">`
  + `<path d="M24 0L46 -15L41 0L46 15Z" fill="${fin}"/>`
  + `<path d="M-30 0C-16 -19 14 -19 27 0C14 19 -16 19 -30 0Z" fill="${body}"/>`
  + `<path d="M-6 -14Q4 -26 14 -12Z" fill="${fin}"/>`
  + `<circle cx="-17" cy="-4" r="3.6" fill="#13203a"/></g>`;

const leaf = (x, y, angle, len) =>
  `<path d="M0 0Q${f(len * 0.45)} ${f(-len * 0.3)} ${f(len)} ${f(len * 0.12)}Q${f(len * 0.5)} ${f(-len * 0.05)} 0 0Z" transform="translate(${f(x)} ${f(y)}) rotate(${angle})"/>`;

const palm = (x, y, topX, topY) =>
  `<path d="M${x} ${y}Q${f((x + topX) / 2 - (topX - x) * 0.3)} ${f((y + topY) / 2)} ${topX} ${topY}" stroke="#9a6a45" stroke-width="20" stroke-linecap="round" fill="none"/>`
  + `<path d="M${x} ${y}Q${f((x + topX) / 2 - (topX - x) * 0.3)} ${f((y + topY) / 2)} ${topX} ${topY}" stroke="#7a4f30" stroke-width="20" stroke-dasharray="4 18" fill="none"/>`
  + `<g fill="#2fae5a">${[-170, -135, -100, -60, -20, 15].map((a) => leaf(topX, topY, a, 150)).join('')}</g>`
  + `<g fill="#5fd27a" opacity="0.8">${[-150, -80, -5].map((a) => leaf(topX, topY, a, 110)).join('')}</g>`;

const seaweed = (x, y, h, sway, color) =>
  `<path d="M${x} ${y}C${x + sway} ${f(y - h * 0.33)} ${x - sway} ${f(y - h * 0.66)} ${x + sway * 0.5} ${f(y - h)}" stroke="${color}" stroke-width="9" stroke-linecap="round" fill="none"/>`;

const coralBranch = (x, y, color) =>
  `<g stroke="${color}" stroke-width="11" stroke-linecap="round" fill="none">`
  + `<path d="M${x} ${y}V${y - 70}M${x} ${y - 30}L${x - 34} ${y - 76}M${x} ${y - 46}L${x + 32} ${y - 96}M${x - 34} ${y - 76}L${x - 40} ${y - 110}M${x + 32} ${y - 96}L${x + 50} ${y - 118}"/></g>`;

const reefFloor = (sandTop, sandBottom) =>
  `<rect y="570" width="1000" height="430" fill="url(#sand)"/>`
  + `<defs><linearGradient id="sand" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sandTop}" stop-opacity="0"/><stop offset="0.12" stop-color="${sandTop}"/><stop offset="1" stop-color="${sandBottom}"/></linearGradient></defs>`
  + `<g stroke="#ffffff" stroke-opacity="0.45" stroke-width="3" fill="none">`
  + `<path d="M40 680q40 -14 80 0t80 0M640 700q40 -14 80 0t80 0t80 0M90 900q40 -14 80 0t80 0M760 930q40 -14 80 0t80 0"/></g>`;

// Coral at the floor's sides, clear of the dance floor and the name card.
const reefCorals = () =>
  seaweed(36, 870, 250, 22, '#3ccf7a') + seaweed(964, 870, 260, -24, '#3ccf7a')
  + seaweed(160, 760, 140, -16, '#5fe08f') + seaweed(846, 760, 130, 16, '#5fe08f')
  + coralBranch(92, 800, '#9a6bff') + coralBranch(900, 800, '#ff7fbf')
  + `<g fill="#ff9a3c"><rect x="30" y="806" width="18" height="60" rx="9"/><rect x="52" y="790" width="18" height="76" rx="9"/></g>`
  + `<g fill="#c45cff"><rect x="932" y="806" width="20" height="60" rx="10"/><rect x="956" y="788" width="20" height="78" rx="10"/></g>`
  + `<ellipse cx="128" cy="842" rx="58" ry="30" fill="#ff9ad0"/><ellipse cx="128" cy="832" rx="42" ry="14" fill="#ffc2e3" opacity="0.7"/>`
  + `<ellipse cx="872" cy="846" rx="62" ry="30" fill="#7ad0ff"/><ellipse cx="872" cy="836" rx="46" ry="14" fill="#bfeaff" opacity="0.7"/>`;

const sunShafts = (fromX, spread, opacity) =>
  [-2, -1, 0, 1, 2].map((i) => {
    const x = fromX + i * spread;
    return `<polygon points="${x - 30},0 ${x + 30},0 ${x + 120 + i * 60},700 ${x + 20 + i * 60},700" fill="#ffffff" opacity="${opacity}"/>`;
  }).join('');

const STAGES = [
  {
    name: 'Skyline Sanctuary',
    accent: ['#7fe3ff', '#0a8fd8'],
    scene: () => `
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3d7fd8"/><stop offset="0.6" stop-color="#8ec5f2"/><stop offset="1" stop-color="#e4f6ff"/></linearGradient>
<radialGradient id="sunGlow"><stop offset="0" stop-color="#ffffff"/><stop offset="0.25" stop-color="#ffffff" stop-opacity="0.8"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
<linearGradient id="tower" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#c8f6ff"/><stop offset="0.45" stop-color="#5ecdf0"/><stop offset="1" stop-color="#2a9ad6"/></linearGradient>
<pattern id="floors" width="12" height="16" patternUnits="userSpaceOnUse"><rect width="12" height="4" fill="#ffffff" opacity="0.6"/></pattern>
<pattern id="lattice" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M0 0L28 28M28 0L0 28" stroke="#ffffff" stroke-opacity="0.55" stroke-width="2"/></pattern>
<linearGradient id="ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e6f8ff"/><stop offset="1" stop-color="#b8e4f6"/></linearGradient>
</defs>
<rect width="1000" height="1000" fill="url(#sky)"/>
<circle cx="800" cy="330" r="190" fill="url(#sunGlow)"/>
${cloud(170, 470, 1.15)}${cloud(620, 420, 1)}${cloud(470, 560, 0.75)}${cloud(80, 300, 0.6)}
<g fill="#bfe8f6">${[[230, 34, 80], [272, 26, 120], [304, 40, 64], [600, 30, 100], [636, 44, 70], [690, 26, 130], [724, 36, 86]].map(([x, w, h]) => `<rect x="${x}" y="${640 - h}" width="${w}" height="${h}" rx="4"/>`).join('')}</g>
<g fill="url(#floors)" opacity="0.6">${[[230, 34, 80], [272, 26, 120], [690, 26, 130]].map(([x, w, h]) => `<rect x="${x}" y="${640 - h}" width="${w}" height="${h}"/>`).join('')}</g>
${turbine(390, 640, 0.75)}${turbine(560, 636, 0.55)}${turbine(800, 630, 0.65)}
<path d="M-40 680V160Q40 90 120 160V680Z" fill="url(#tower)"/><path d="M-40 680V160Q40 90 120 160V680Z" fill="url(#floors)"/>
<path d="M880 680L900 120Q960 70 1040 120V680Z" fill="url(#tower)"/><path d="M880 680L900 120Q960 70 1040 120V680Z" fill="url(#lattice)"/>
<rect y="628" width="1000" height="372" fill="url(#ground)"/>
<path d="M0 640H1000" stroke="#ffffff" stroke-width="3" opacity="0.8"/>
<path d="M60 662H300M700 668H960" stroke="#9fdcf2" stroke-width="4" stroke-linecap="round"/>`,
  },
  {
    name: 'Coral Dome',
    accent: ['#7ff7ec', '#0a9fb8'],
    scene: () => `
<defs>
<linearGradient id="water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9aeaf5"/><stop offset="0.2" stop-color="#47c0ea"/><stop offset="0.62" stop-color="#1170c8"/><stop offset="1" stop-color="#0c5cb6"/></linearGradient>
</defs>
<rect width="1000" height="1000" fill="url(#water)"/>
<g stroke="#ffffff" stroke-opacity="0.3" stroke-width="3" fill="none"><path d="M0 50q30 -18 60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0"/><path d="M-20 110q40 -20 80 0t80 0t80 0t80 0t80 0t80 0t80 0t80 0t80 0t80 0t80 0t80 0t80 0"/></g>
${sunShafts(260, 130, 0.08)}
<g transform="translate(200 320)"><path d="M-46 0C-46 -50 46 -50 46 0Q23 10 0 2Q-23 10 -46 0Z" fill="#ffb0dc" opacity="0.8"/><path d="M-26 4q6 30 -4 60M0 6q-6 34 4 66M26 4q8 28 -2 58" stroke="#ffb0dc" stroke-width="5" stroke-linecap="round" fill="none" opacity="0.7"/></g>
${[[760, 290, 1.1], [820, 245, 0.9], [870, 320, 1], [700, 240, 0.8], [905, 230, 0.75], [790, 360, 0.85]].map(([x, y, s]) => fish(x, y, s, '#ffd84a', '#f0a500')).join('')}
${reefFloor('#a9dcea', '#dff4f2')}
${reefCorals()}`,
    // The glass dome over the dance floor: drawn behind the trophy, with a sheen in front.
    dome: true,
  },
  {
    name: 'Open Reef',
    accent: ['#8fe4ff', '#1a7fd0'],
    scene: () => `
<defs>
<linearGradient id="water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bff6ff"/><stop offset="0.22" stop-color="#5fd0f2"/><stop offset="0.66" stop-color="#1a8ad8"/><stop offset="1" stop-color="#1170c8"/></linearGradient>
</defs>
<rect width="1000" height="1000" fill="url(#water)"/>
${sunShafts(330, 150, 0.12)}
<path d="M640 640C640 420 900 400 930 640" stroke="#7d7fe0" stroke-width="54" fill="none" opacity="0.75"/>
<path d="M640 640C640 420 900 400 930 640" stroke="#a6a8ff" stroke-width="14" fill="none" opacity="0.5"/>
<g fill="#c4c6ff" opacity="0.6"><circle cx="652" cy="560" r="8"/><circle cx="700" cy="470" r="10"/><circle cx="790" cy="452" r="7"/><circle cx="880" cy="500" r="9"/><circle cx="916" cy="590" r="6"/></g>
${[[170, 260], [215, 235], [240, 285], [130, 300], [200, 330], [270, 250]].map(([x, y]) => fish(x, y, 0.55, '#5ff0ff', '#2fb8e8', -1)).join('')}
${fish(820, 200, 1.3, '#ffd84a', '#f0a500')}
${seaweed(70, 700, 260, 26, '#2fbf6a')}${seaweed(110, 700, 200, -20, '#4fdc85')}${seaweed(900, 700, 280, -26, '#2fbf6a')}
${reefFloor('#e9f7ee', '#d6eee4')}
${reefCorals()}`,
  },
  {
    name: 'Emerald Falls',
    accent: ['#b6f27a', '#3aa82a'],
    scene: () => `
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4aa8ff"/><stop offset="0.65" stop-color="#a8dcff"/><stop offset="1" stop-color="#e8fbff"/></linearGradient>
<linearGradient id="cliff" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#46b85a"/><stop offset="0.12" stop-color="#3a9a52"/><stop offset="0.16" stop-color="#7f9e8a"/><stop offset="1" stop-color="#5b7d6c"/></linearGradient>
<linearGradient id="falls" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#bfefff"/><stop offset="0.5" stop-color="#ffffff"/><stop offset="1" stop-color="#9fe2fa"/></linearGradient>
<linearGradient id="meadow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b6ec8a"/><stop offset="1" stop-color="#62c450"/></linearGradient>
</defs>
<rect width="1000" height="1000" fill="url(#sky)"/>
${cloud(560, 210, 0.7)}${cloud(330, 330, 0.5)}
<g fill="none" stroke-width="12" opacity="0.38">${['#ff5f6d', '#ffa64d', '#ffe24d', '#5fdc6a', '#4fb8ff', '#9a6bff'].map((c, i) => `<path d="M${450 + i * 12} 640A${330 - i * 12} ${330 - i * 12} 0 0 1 ${1110 - i * 12} 640" stroke="${c}"/>`).join('')}</g>
<path d="M300 640L420 500L520 580L640 470L760 560L1000 480V640Z" fill="#9fd8cc" opacity="0.8"/>
<path d="M0 640V250Q40 220 120 236Q200 220 270 250L300 640Z" fill="url(#cliff)"/>
<path d="M150 252H210L214 640H146Z" fill="url(#falls)"/>
<path d="M156 260V630M172 260V630M190 260V630M204 260V630" stroke="#ffffff" stroke-width="3" opacity="0.8"/>
<g fill="#ffffff" opacity="0.85"><ellipse cx="180" cy="636" rx="70" ry="22"/><ellipse cx="140" cy="626" rx="34" ry="16"/><ellipse cx="222" cy="628" rx="36" ry="15"/></g>
<g transform="translate(760 300)"><path d="M-80 0Q0 18 80 0L20 70L0 110L-24 64Z" fill="#7f9e8a"/><ellipse cx="0" cy="0" rx="82" ry="18" fill="#4fc35e"/></g>
<g transform="translate(900 170) scale(0.55)"><path d="M-80 0Q0 18 80 0L20 70L0 110L-24 64Z" fill="#7f9e8a"/><ellipse cx="0" cy="0" rx="82" ry="18" fill="#4fc35e"/></g>
<path d="M600 650Q760 560 1000 600V700H600Z" fill="#5cc45a"/>
<rect y="640" width="1000" height="360" fill="url(#meadow)"/>
<g fill="#ffffff">${[[70, 700], [130, 760], [880, 720], [930, 790], [60, 860], [940, 900]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5"/>`).join('')}</g>
<g fill="#ff9ad0">${[[100, 730], [910, 760], [40, 800]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5"/>`).join('')}</g>`,
  },
  {
    name: 'Club Aquarium',
    accent: ['#7ff3ff', '#7a2bd8'],
    scene: () => `
<defs>
<linearGradient id="club" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d0a36"/><stop offset="0.6" stop-color="#2c1670"/><stop offset="1" stop-color="#4b2390"/></linearGradient>
<linearGradient id="tank" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a8ff0"/><stop offset="1" stop-color="#1a3f9a"/></linearGradient>
<filter id="neon" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<rect width="1000" height="1000" fill="url(#club)"/>
<rect x="40" y="150" width="300" height="490" rx="12" fill="url(#tank)"/>
${seaweed(80, 640, 200, 16, '#3ccf7a')}${seaweed(150, 640, 150, -14, '#5fe08f')}${seaweed(300, 640, 220, -18, '#3ccf7a')}
${fish(130, 300, 0.7, '#ffd84a', '#3fd0ff')}${fish(250, 380, 0.6, '#ff9a3c', '#ffffff', -1)}${fish(200, 250, 0.5, '#3fd0ff', '#ffd84a')}
<g fill="none" stroke="#ffffff" stroke-opacity="0.7" stroke-width="2">${[[90, 520, 6], [110, 470, 4], [270, 560, 7], [250, 500, 4], [180, 430, 5]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g>
<rect x="40" y="150" width="300" height="490" rx="12" fill="none" stroke="#9fe8ff" stroke-opacity="0.7" stroke-width="5"/>
<path d="M190 150V640" stroke="#9fe8ff" stroke-opacity="0.5" stroke-width="4"/>
<rect x="836" y="110" width="44" height="560" rx="22" fill="#bff6ff" opacity="0.22" filter="url(#neon)"/>
<g fill="#ffffff" opacity="0.7">${[180, 260, 330, 420, 500, 580].map((y, i) => `<circle cx="${858 + (i % 2 ? 6 : -6)}" cy="${y}" r="${4 + (i % 3)}"/>`).join('')}</g>
<g fill="none" stroke="#7ff3ff" filter="url(#neon)"><circle cx="760" cy="220" r="86" stroke-width="6" opacity="0.7"/><circle cx="760" cy="220" r="60" stroke-width="3" opacity="0.5"/></g>
<g stroke-width="3" opacity="0.75" filter="url(#neon)"><path d="M0 110L1000 430" stroke="#d8ff6a"/><path d="M1000 70L0 380" stroke="#7ff3ff"/><path d="M0 300L1000 150" stroke="#ff7ad8"/></g>
<rect y="640" width="1000" height="360" fill="#1a1050"/>`,
    floor: { top: ['#4a63d8', '#24308a'], side: ['#6a7fe8', '#1e2470'], rim: '#7ff3ff', tiles: true },
  },
  {
    name: 'Sugarsand Sunset',
    accent: ['#ffd27a', '#ff8a2a'],
    scene: () => `
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6f61"/><stop offset="0.45" stop-color="#ff9a5e"/><stop offset="0.8" stop-color="#ffc979"/><stop offset="1" stop-color="#ffe6a8"/></linearGradient>
<radialGradient id="sunGlow"><stop offset="0" stop-color="#fff6d0"/><stop offset="0.3" stop-color="#ffe0a0" stop-opacity="0.7"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient>
<linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffa07a"/><stop offset="0.4" stop-color="#6f9fd8"/><stop offset="1" stop-color="#3a7cc4"/></linearGradient>
<linearGradient id="beach" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe6bb"/><stop offset="1" stop-color="#f6c98d"/></linearGradient>
</defs>
<rect width="1000" height="1000" fill="url(#sky)"/>
<circle cx="500" cy="600" r="330" fill="url(#sunGlow)"/>
<circle cx="500" cy="600" r="104" fill="#fff1c4"/>
<g fill="#ffb7a0" opacity="0.6"><ellipse cx="230" cy="300" rx="150" ry="14"/><ellipse cx="760" cy="250" rx="180" ry="16"/><ellipse cx="660" cy="380" rx="120" ry="10"/></g>
<rect y="600" width="1000" height="100" fill="url(#sea)"/>
<g stroke="#ffe8b0" stroke-width="5" stroke-linecap="round" opacity="0.8"><path d="M440 614H560M460 632H540M430 652H570M470 672H530"/></g>
<rect y="690" width="1000" height="310" fill="url(#beach)"/>
<path d="M0 694Q250 680 500 694T1000 694" stroke="#ffffff" stroke-width="6" fill="none" opacity="0.8"/>
${palm(70, 760, 190, 280)}${palm(950, 780, 830, 320)}
<g transform="translate(880 800)"><circle r="34" fill="#ffffff"/><path d="M0 -34A34 34 0 0 1 34 0L0 0Z" fill="#ff5f8a"/><path d="M0 34A34 34 0 0 1 -34 0L0 0Z" fill="#4fb8ff"/><path d="M-34 0A34 34 0 0 1 0 -34L0 0Z" fill="#ffd84a"/><ellipse cx="-11" cy="-14" rx="10" ry="6" fill="#ffffff" opacity="0.8"/></g>`,
  },
];

// Glass colours by hue: the dancers' blue and purple, the wordmark's mint and friends.
const GLASS = [['Aqua', 188], ['Azure', 210], ['Violet', 272], ['Rose', 328], ['Lime', 96], ['Gold', 44], ['Mint', 162]];
const SHAPES = [['Classic', 30], ['Goblet', 24], ['Bubble', 20], ['Star', 14], ['Dancer', 12]];

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
function weighted(rand, entries) {
  let r = rand() * entries.reduce((sum, [, w]) => sum + w, 0);
  for (const [value, w] of entries) if ((r -= w) < 0) return value;
  return entries[entries.length - 1][0];
}

// The trophy's traits, shared by its image and its NFT attributes.
export function trophyTraits(b) {
  const rand = seeded(b.id, 'traits');
  const stage = pick(rand, STAGES);
  const [glass, hue] = pick(rand, GLASS);
  const cup = weighted(rand, SHAPES);
  const roll = rand();
  const finish = roll < 0.1 ? 'Iridescent' : roll < 0.32 ? 'Chrome' : 'Glass';
  return { stage, glass: finish === 'Iridescent' ? 'Opal' : glass, hue, cup, finish, aura: (b.sync ?? 0) >= AURA_SYNC };
}

// ---------- the trophy ----------

// Cup bowls all end at the stem (500, 602). inside: the box the bowl's fizz floats in.
const CLASSIC = {
  bowl: 'M335 300C335 470 420 590 500 602C580 590 665 470 665 300Z',
  rim: [500, 300, 165, 30],
  handles: ['M343 345C250 330 245 470 392 520', 'M657 345C750 330 755 470 608 520'],
  shine: 'M368 322C370 430 405 515 452 562',
  inside: [345, 315, 655, 590],
};
const BOWLS = {
  Classic: CLASSIC,
  Goblet: {
    bowl: 'M375 258C370 420 440 575 500 602C560 575 630 420 625 258Z',
    rim: [500, 258, 125, 24],
    handles: [],
    shine: 'M398 280C398 410 430 510 470 568',
    inside: [380, 272, 620, 590],
  },
  Star: { ...CLASSIC, star: true },
};

// The game's bubble dancer (round head, bell body, floating hands and feet) in a victory
// pose, feet on y, s times the figurine's size.
const FIGURINE = { x: 500, y: PEDESTAL_Y - 4, s: 0.9 };

function dancerBody(x, y, s) {
  const p = (dx, dy) => `${f(x + dx * s)} ${f(y + dy * s)}`;
  return `M${p(0, -258)}C${p(-46, -258)} ${p(-70, -236)} ${p(-78, -196)}C${p(-90, -132)} ${p(-114, -88)} ${p(-114, -62)}`
    + `C${p(-114, -40)} ${p(-96, -34)} ${p(-72, -34)}H${f(x + 72 * s)}C${p(96, -34)} ${p(114, -40)} ${p(114, -62)}`
    + `C${p(114, -88)} ${p(90, -132)} ${p(78, -196)}C${p(70, -236)} ${p(46, -258)} ${p(0, -258)}Z`;
}

function dancer(x, y, s, fill, eye = '#0b1424') {
  const r = (n) => f(n * s);
  const part = (shape) => shape.replace('/>', ` fill="${fill}"/>`);
  const spec = (cx, cy, rx, ry) =>
    `<ellipse cx="${f(x + cx * s)}" cy="${f(y + cy * s)}" rx="${r(rx)}" ry="${r(ry)}" fill="#ffffff" opacity="0.75" transform="rotate(-30 ${f(x + cx * s)} ${f(y + cy * s)})"/>`;
  return [
    part(`<ellipse cx="${f(x - 54 * s)}" cy="${f(y - 20 * s)}" rx="${r(46)}" ry="${r(24)}"/>`),
    part(`<ellipse cx="${f(x + 54 * s)}" cy="${f(y - 20 * s)}" rx="${r(46)}" ry="${r(24)}"/>`),
    part(`<path d="${dancerBody(x, y, s)}"/>`),
    part(`<circle cx="${f(x)}" cy="${f(y - 342 * s)}" r="${r(92)}"/>`),
    part(`<circle cx="${f(x - 150 * s)}" cy="${f(y - 436 * s)}" r="${r(40)}"/>`),
    part(`<circle cx="${f(x + 150 * s)}" cy="${f(y - 436 * s)}" r="${r(40)}"/>`),
    `<ellipse cx="${f(x - 28 * s)}" cy="${f(y - 350 * s)}" rx="${r(11)}" ry="${r(20)}" fill="${eye}"/>`,
    `<ellipse cx="${f(x + 28 * s)}" cy="${f(y - 350 * s)}" rx="${r(11)}" ry="${r(20)}" fill="${eye}"/>`,
    spec(-40, -392, 30, 14), spec(-44, -205, 16, 30), spec(-166, -452, 12, 7), spec(134, -452, 12, 7),
    spec(-70, -30, 14, 6), spec(38, -30, 14, 6),
  ].join('');
}

function sparkle(x, y, s) {
  const w = s * 0.16;
  return `<path d="M${f(x)} ${f(y - s)}Q${f(x + w)} ${f(y - w)} ${f(x + s)} ${f(y)}Q${f(x + w)} ${f(y + w)} ${f(x)} ${f(y + s)}Q${f(x - w)} ${f(y + w)} ${f(x - s)} ${f(y)}Q${f(x - w)} ${f(y - w)} ${f(x)} ${f(y - s)}Z"/>`;
}

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
  const { stage, hue, finish } = t;
  const rand = seeded(b.id, 'layout');
  // Ids are scoped to the battle so several trophies can share one HTML page.
  const tag = `t${String(b.id).replace(/[^A-Za-z0-9]/g, '')}`;
  const scene = stage.scene().replace(/id="([\w-]+)"/g, `id="$1-${tag}"`).replace(/url\(#([\w-]+)\)/g, `url(#$1-${tag})`);
  const I = (name) => `${name}-${tag}`;
  const U = (name) => `url(#${I(name)})`;
  const light = t.aura ? GOLD[1] : stage.accent[0];
  const floor = stage.floor ?? { top: ['#ffffff', '#c4ecfa'], side: ['#f4fdff', '#86cde6'], rim: '#ffffff' };

  // The finish: tinted glass with a drink in it, polished metal, or a soap-bubble film.
  const sat = finish === 'Chrome' ? 30 : 45;
  const surface = finish === 'Chrome' ? U('metal') : finish === 'Iridescent' ? U('film') : U('glass');
  const tube = finish === 'Glass' ? `hsl(${hue},70%,66%)` : surface;
  // Round parts (the dancer figurine) take chrome as a polished sphere, not a stripe.
  const figure = finish === 'Chrome' ? U('chrome') : surface;

  // Background bubbles stay below the title; a few small ones float in front.
  const bubble = (x, y, r) =>
    `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${U('bubble')}" stroke="${U('iris')}" stroke-width="${f(Math.max(2, r * 0.07))}"/>`
    + `<ellipse cx="${f(x - r * 0.36)}" cy="${f(y - r * 0.42)}" rx="${f(r * 0.28)}" ry="${f(r * 0.15)}" fill="#fff" opacity="0.95" transform="rotate(-34 ${f(x - r * 0.36)} ${f(y - r * 0.42)})"/>`;
  const floating = (count, rMin, rMax) => Array.from({ length: count }, () =>
    bubble(40 + rand() * 920, 170 + rand() * 560, rMin + rand() * (rMax - rMin))).join('');
  const backBubbles = floating(Math.min(28, 6 + Math.round((b.pops ?? 0) * 0.4)), 10, 44);
  const frontBubbles = floating(4, 7, 18);
  const sparkles = Array.from({ length: Math.min(16, 3 + Math.round((b.flair ?? 0) / 7)) }, () =>
    sparkle(60 + rand() * 880, 170 + rand() * 520, 10 + rand() * 16)).join('');

  // Sunburst behind the trophy (drawSunburst): 14 soft rays and an aqua core.
  const rays = Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * Math.PI * 2 + 0.2;
    const h = Math.PI / 28;
    const p = (ang) => `${f(500 + Math.cos(ang) * 620)} ${f(440 + Math.sin(ang) * 620)}`;
    return `M500 440L${p(a - h)}L${p(a + h)}Z`;
  }).join('');

  // ---- the trophy itself ----
  let trophy;
  if (t.cup === 'Dancer') {
    const { x, y, s } = FIGURINE;
    trophy = `<g opacity="${finish === 'Chrome' ? 1 : 0.94}">${dancer(x, y, s, figure)}</g>`
      + (finish === 'Glass' ? `<g clip-path="${U('body')}">${fizz(x - 80 * s, y - 220 * s, x + 80 * s, y - 40 * s, 5)}</g>` : '');
  } else if (t.cup === 'Bubble') {
    // A glass bubble on a stem with a little dancer inside.
    trophy = stem()
      + `<circle cx="500" cy="440" r="158" fill="${surface}" fill-opacity="${finish === 'Chrome' ? 0.35 : 0.3}"/>`
      + `<ellipse cx="500" cy="540" rx="112" ry="22" fill="#ffffff" opacity="0.55"/>`
      + dancer(500, 542, 0.42, finish === 'Chrome' ? U('chrome') : U('jelly'))
      + `<g clip-path="${U('orb')}">${fizz(360, 300, 640, 520, 4)}</g>`
      + `<circle cx="500" cy="440" r="158" fill="${U('bubble')}" stroke="${U('iris')}" stroke-width="7"/>`
      + `<path d="M380 380A130 130 0 0 1 470 304" stroke="#ffffff" stroke-width="18" stroke-linecap="round" fill="none" opacity="0.8"/>`
      + `<ellipse cx="560" cy="345" rx="22" ry="12" fill="#ffffff" opacity="0.7"/>`;
  } else {
    const cup = BOWLS[t.cup];
    const [x0, y0, x1, y1] = cup.inside;
    const waterline = f(y0 + (y1 - y0) * 0.36);
    const handles = cup.handles.map((d) =>
      `<path d="${d}" fill="none" stroke="${tube}" stroke-width="22" stroke-linecap="round"/>`
      + `<path d="${d}" fill="none" stroke="#fff" stroke-opacity="0.6" stroke-width="6" stroke-linecap="round"/>`).join('');
    const contents = finish === 'Glass'
      ? `<rect x="${x0 - 20}" y="${waterline}" width="${x1 - x0 + 40}" height="${y1 - waterline + 30}" fill="${U('drink')}"/>`
        + `<ellipse cx="500" cy="${waterline}" rx="${(x1 - x0) / 2 + 10}" ry="16" fill="hsl(${hue},95%,86%)" opacity="0.9"/>`
        + fizz(x0, waterline + 20, x1, y1, 10)
      : finish === 'Iridescent'
        ? fizz(x0, y0, x1, y1, 6)
        : `<rect x="${x0 - 20}" y="${f((y0 + y1) / 2 - 20)}" width="${x1 - x0 + 40}" height="34" fill="#ffffff" opacity="0.28"/>`;
    trophy = stem()
      + (cup.star ? `<rect x="493" y="232" width="14" height="60" rx="5" fill="${U('metal')}"/><path d="${starPath(500, 198, 70, 30)}" fill="${surface}" stroke="#fff" stroke-opacity="0.9" stroke-width="5" stroke-linejoin="round" filter="${U('glow')}"/>` : '')
      + handles
      + `<path d="${cup.bowl}" fill="${surface}" fill-opacity="${finish === 'Chrome' ? 1 : finish === 'Iridescent' ? 0.75 : 0.42}"/>`
      + `<g clip-path="${U('bowl')}">${contents}</g>`
      + (finish === 'Chrome' ? '' : `<path d="${cup.bowl}" fill="${U('bubble')}" opacity="0.6"/>`)
      + `<path d="${cup.bowl}" fill="none" stroke="#fff" stroke-opacity="0.75" stroke-width="4"/>`
      + `<path d="${cup.shine}" fill="none" stroke="#fff" stroke-opacity="0.7" stroke-width="16" stroke-linecap="round"/>`
      + `<ellipse cx="${f(x1 - 50)}" cy="${f(y0 + 40)}" rx="14" ry="8" fill="#fff" opacity="0.7"/>`
      + `<ellipse cx="${cup.rim[0]}" cy="${cup.rim[1]}" rx="${cup.rim[2]}" ry="${cup.rim[3]}" fill="hsl(${hue},60%,${finish === 'Chrome' ? 30 : 75}%)" fill-opacity="0.55" stroke="#fff" stroke-opacity="0.9" stroke-width="5"/>`;
  }

  function stem() {
    return `<path d="M484 704C484 672 493 650 493 604H507C507 650 516 672 516 704Z" fill="${U('metal')}"/>`
      + `<ellipse cx="500" cy="654" rx="24" ry="9" fill="${U('metal')}"/>`
      + `<ellipse cx="500" cy="604" rx="34" ry="9" fill="${U('metal')}"/>`
      + `<path d="M436 700V708A64 12 0 0 0 564 708V700Z" fill="${U('metal')}"/>`
      + `<ellipse cx="500" cy="700" rx="64" ry="12" fill="hsl(${hue},${sat}%,88%)"/>`;
  }

  function fizz(x0, y0, x1, y1, n) {
    return Array.from({ length: n }, () => {
      const r = 4 + rand() * 12;
      return bubble(x0 + r + rand() * (x1 - x0 - 2 * r), y0 + r + rand() * Math.max(0, y1 - y0 - 2 * r), r);
    }).join('')
      + `<g fill="#fff">${Array.from({ length: 3 }, () => sparkle(x0 + rand() * (x1 - x0), y0 + rand() * (y1 - y0), 6 + rand() * 9)).join('')}</g>`;
  }

  // ---- the dance floor ----
  const ringRx = [270, 196, 120];
  const tiles = floor.tiles
    ? `<g clip-path="${U('floorTop')}">${Array.from({ length: 24 }, (_, i) => {
      const col = i % 8;
      const row = Math.floor(i / 8);
      const c = ['#ff7ad8', '#7ff3ff', '#d8ff6a', '#b48cff'][(col + row * 3) % 4];
      return `<rect x="${200 + col * 76}" y="${FLOOR_Y - 52 + row * 36}" width="64" height="28" rx="4" fill="${c}" opacity="${f(0.25 + ((col * 7 + row * 5) % 5) * 0.08)}"/>`;
    }).join('')}</g>`
    : '';
  const dancefloor = `
<path d="M190 ${FLOOR_Y}V${FLOOR_Y + 38}A310 64 0 0 0 810 ${FLOOR_Y + 38}V${FLOOR_Y}Z" fill="${U('floorSide')}"/>
<ellipse cx="500" cy="${FLOOR_Y}" rx="310" ry="64" fill="${U('floorTopFill')}" stroke="${floor.rim}" stroke-opacity="0.9" stroke-width="4"/>
${tiles}
<ellipse cx="500" cy="${FLOOR_Y}" rx="290" ry="58" fill="none" stroke="#fff" stroke-opacity="0.5" stroke-width="2" stroke-dasharray="20 14"/>
<ellipse cx="500" cy="${FLOOR_Y + 4}" rx="190" ry="40" fill="${U('halo')}"/>
<g fill="none" stroke="${light}" filter="${U('glow')}">${ringRx.map((rx, i) =>
    `<ellipse cx="500" cy="${FLOOR_Y + 4}" rx="${rx}" ry="${f(rx * 0.2)}" stroke-width="${5 - i}" opacity="${f(0.95 - i * 0.12)}"/>`).join('')}</g>
<path d="M200 ${FLOOR_Y + 14}Q500 ${FLOOR_Y + 90} 800 ${FLOOR_Y + 14}" stroke="#fff" stroke-opacity="0.6" stroke-width="4" fill="none"/>`;

  // The glass pedestal and its WINNER name card.
  const pedestal = `
<path d="M408 ${PEDESTAL_Y}V${FLOOR_Y - 6}A92 18 0 0 0 592 ${FLOOR_Y - 6}V${PEDESTAL_Y}Z" fill="${U('floorSide')}"/>
<ellipse cx="500" cy="${PEDESTAL_Y}" rx="92" ry="18" fill="${U('floorTopFill')}" stroke="#fff" stroke-width="3"/>
${glassPill(444, PEDESTAL_Y + 22, 112, 28)}
<text x="500" y="${PEDESTAL_Y + 41}" font-family="${FONT}" font-size="14" font-weight="800" text-anchor="middle" letter-spacing="3" fill="${NAVY}">WINNER</text>`;

  // Glass pill from the stage name cards (WinHud's glassPill).
  function glassPill(x, y, w, h, rim) {
    const r = h / 2;
    return `<g filter="${U('pillShadow')}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${U('pill')}" stroke="#fff" stroke-opacity="0.95" stroke-width="2.5"/></g>`
      + `<rect x="${x + Math.min(16, w * 0.1)}" y="${y + 3}" width="${w - 2 * Math.min(16, w * 0.1)}" height="${f(h * 0.42)}" rx="${f(h * 0.2)}" fill="${U('pillSheen')}"/>`
      + (rim ? `<rect x="${x - 3}" y="${y - 3}" width="${w + 6}" height="${h + 6}" rx="${r + 3}" fill="none" stroke="${rim}" stroke-width="5" filter="${U('glow')}"/>` : '');
  }

  // Gold winner's medal with a star (drawMedal).
  const medal = (x, y, r) =>
    `<g filter="${U('medalShadow')}"><circle cx="${x}" cy="${y}" r="${r}" fill="${U('medal')}" stroke="#fff" stroke-opacity="0.85" stroke-width="${f(r * 0.08)}"/></g>`
    + `<path d="${starPath(x, y, r * 0.58, r * 0.25)}" fill="#fff"/>`
    + `<ellipse cx="${f(x - r * 0.1)}" cy="${f(y - r * 0.5)}" rx="${f(r * 0.6)}" ry="${f(r * 0.28)}" fill="#fff" opacity="0.35" transform="rotate(-11 ${f(x - r * 0.1)} ${f(y - r * 0.5)})"/>`;

  // The title screen's "aerodance." wordmark (drawTitle): ExtraBold "aero", ExtraLight
  // "dance", a white-to-ice face over navy shadows and a square mint full stop.
  const title = (x, y, size) => {
    const aeroW = size * 2.1;
    const danceW = size * 2.6;
    const s = size * 0.15;
    const word = (str, wx, w, weight) =>
      `<text x="${f(wx)}" y="${y}" font-size="${size}" font-weight="${weight}" textLength="${f(w)}" lengthAdjust="spacingAndGlyphs">${str}</text>`;
    return `<g font-family="${FONT}" fill="${U('titleFace')}" filter="${U('titleShadow')}">${word('aero', x, aeroW, 800)}${word('dance', x + aeroW, danceW, 200)}`
      + `<rect x="${f(x + aeroW + danceW + size * 0.04)}" y="${f(y - s)}" width="${f(s)}" height="${f(s)}" fill="${MINT}"/></g>`;
  };

  const date = b.created_at.toISOString().slice(0, 10);
  const finishWord = finish === 'Glass' ? 'glass' : finish.toLowerCase();
  const caption = `${t.glass} ${finishWord} ${t.cup.toLowerCase()} · ${date}`;
  const metal = [
    [0, `hsl(${hue},${sat}%,30%)`], [0.3, `hsl(${hue},${sat}%,76%)`], [0.42, '#ffffff'],
    [0.62, `hsl(${hue},${sat}%,60%)`], [1, `hsl(${hue},${sat}%,28%)`],
  ];
  const stops = (list) => list.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}"${a < 1 ? ` stop-opacity="${a}"` : ''}/>`).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">
<defs>
<radialGradient id="${I('bubble')}" cx="0.5" cy="0.5" r="0.5" fx="0.35" fy="0.32">${stops([[0, '#ffffff', 0.6], [0.45, '#aaebff', 0.14], [0.82, '#6ed2ff', 0.28], [1, '#ffffff', 0.85]])}</radialGradient>
<linearGradient id="${I('iris')}" x1="0" y1="0" x2="1" y2="1">${stops([[0, '#ffffff'], [0.3, '#ffc4ec'], [0.55, '#bff6ff'], [0.8, '#fff3b0'], [1, '#ffffff']])}</linearGradient>
<radialGradient id="${I('glass')}" cx="0.38" cy="0.3" r="0.8">${stops([[0, `hsl(${hue},100%,96%)`], [0.4, `hsl(${hue},90%,74%)`], [0.85, `hsl(${hue},80%,50%)`], [1, `hsl(${hue},85%,36%)`]])}</radialGradient>
<radialGradient id="${I('jelly')}" cx="0.38" cy="0.3" r="0.8">${stops([[0, `hsl(${hue},100%,92%)`], [0.4, `hsl(${hue},90%,68%)`], [1, `hsl(${hue},85%,40%)`]])}</radialGradient>
<linearGradient id="${I('drink')}" x1="0" y1="0" x2="0" y2="1">${stops([[0, `hsl(${hue},90%,66%)`, 0.9], [1, `hsl(${hue},85%,38%)`, 0.95]])}</linearGradient>
<linearGradient id="${I('film')}" x1="0" y1="0" x2="1" y2="1">${stops([[0, '#ffd6f3'], [0.25, '#bdf3ff'], [0.5, '#fff7c2'], [0.75, '#d9c9ff'], [1, '#aaf7e4']])}</linearGradient>
<linearGradient id="${I('metal')}" x1="0" y1="0" x2="1" y2="0">${stops(metal)}</linearGradient>
<radialGradient id="${I('chrome')}" cx="0.4" cy="0.32" r="0.72">${stops([[0, '#ffffff'], [0.22, `hsl(${hue},${sat}%,88%)`], [0.55, `hsl(${hue},${sat}%,58%)`], [0.85, `hsl(${hue},${sat + 5}%,30%)`], [1, `hsl(${hue},${sat}%,62%)`]])}</radialGradient>
<linearGradient id="${I('column')}" x1="0" y1="0" x2="1" y2="0">${stops([[0, light, 0], [0.5, light, 0.55], [1, light, 0]])}</linearGradient>
<linearGradient id="${I('columnFade')}" x1="0" y1="0" x2="0" y2="1">${stops([[0, '#fff', 0.2], [0.75, '#fff', 1], [1, '#fff', 1]])}</linearGradient>
<mask id="${I('columnMask')}"><rect width="1000" height="1000" fill="${U('columnFade')}"/></mask>
<radialGradient id="${I('ray')}" cx="500" cy="440" r="620" gradientUnits="userSpaceOnUse">${stops([[0.08, '#ffffff', 0.75], [0.45, '#c8f5ff', 0.32], [1, '#a0ebff', 0]])}</radialGradient>
<radialGradient id="${I('core')}" cx="0.5" cy="0.5" r="0.5">${stops([[0, '#ffffff', 0.9], [0.35, '#96f0e6', 0.45], [1, '#5ac8ff', 0]])}</radialGradient>
<radialGradient id="${I('aura')}" cx="0.5" cy="0.5" r="0.5">${stops([[0, '#ffe680', 0.8], [0.55, '#ffd34d', 0.3], [1, '#ffd34d', 0]])}</radialGradient>
<radialGradient id="${I('halo')}" cx="0.5" cy="0.5" r="0.5">${stops([[0, light, 0.85], [0.6, light, 0.3], [1, light, 0]])}</radialGradient>
<radialGradient id="${I('floorTopFill')}" cx="0.5" cy="0.4" r="0.6">${stops([[0, floor.top[0]], [1, floor.top[1]]])}</radialGradient>
<linearGradient id="${I('floorSide')}" x1="0" y1="0" x2="0" y2="1">${stops([[0, floor.side[0]], [1, floor.side[1]]])}</linearGradient>
<linearGradient id="${I('pill')}" x1="0" y1="0" x2="0" y2="1">${stops([[0, '#ffffff', 0.94], [0.5, '#d6f6ff', 0.86], [0.51, '#b0e8fa', 0.82], [1, '#defcff', 0.9]])}</linearGradient>
<linearGradient id="${I('pillSheen')}" x1="0" y1="0" x2="0" y2="1">${stops([[0, '#ffffff', 0.9], [1, '#ffffff', 0.08]])}</linearGradient>
<linearGradient id="${I('medal')}" x1="0" y1="0" x2="0" y2="1">${stops([[0, GOLD[0]], [0.45, GOLD[1]], [1, GOLD[2]]])}</linearGradient>
<linearGradient id="${I('titleFace')}" x1="0" y1="0" x2="0" y2="1">${stops([[0, '#ffffff'], [0.55, '#ffffff'], [1, '#d5f3ff']])}</linearGradient>
<clipPath id="${I('floorTop')}"><ellipse cx="500" cy="${FLOOR_Y}" rx="306" ry="61"/></clipPath>
${BOWLS[t.cup] ? `<clipPath id="${I('bowl')}"><path d="${BOWLS[t.cup].bowl}"/></clipPath>` : ''}
<clipPath id="${I('orb')}"><circle cx="500" cy="440" r="156"/></clipPath>
<clipPath id="${I('body')}"><path d="${dancerBody(FIGURINE.x, FIGURINE.y, FIGURINE.s)}"/></clipPath>
<filter id="${I('glow')}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="${I('sparkleGlow')}" x="-50%" y="-50%" width="200%" height="200%"><feFlood flood-color="#a0f0ff" flood-opacity="0.9"/><feComposite in2="SourceAlpha" operator="in"/><feGaussianBlur stdDeviation="6" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="${I('titleShadow')}" x="-20%" y="-60%" width="140%" height="220%"><feDropShadow dx="0" dy="4" stdDeviation="10" flood-color="#001c46" flood-opacity="0.5"/><feDropShadow dx="0" dy="3.5" stdDeviation="1.5" flood-color="#002254" flood-opacity="0.75"/></filter>
<filter id="${I('pillShadow')}" x="-20%" y="-50%" width="140%" height="220%"><feDropShadow dx="0" dy="4" stdDeviation="7" flood-color="#002850" flood-opacity="0.35"/></filter>
<filter id="${I('medalShadow')}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#784600" flood-opacity="0.45"/></filter>
</defs>
${scene}
<rect x="380" y="0" width="240" height="${FLOOR_Y}" fill="${U('column')}" mask="${U('columnMask')}"/>
<path d="${rays}" fill="${U('ray')}" opacity="0.55"/>
<circle cx="500" cy="440" r="260" fill="${U('core')}" opacity="0.7"/>
${backBubbles}
${stage.dome ? `<g fill="none" stroke="#ffffff"><path d="M196 ${FLOOR_Y}C196 420 330 286 500 286C670 286 804 420 804 ${FLOOR_Y}" fill="#ffffff" fill-opacity="0.08" stroke-opacity="0.75" stroke-width="5"/><path d="M340 ${FLOOR_Y - 10}C346 470 420 320 500 286M660 ${FLOOR_Y - 10}C654 470 580 320 500 286" stroke-opacity="0.4" stroke-width="4"/></g><ellipse cx="500" cy="286" rx="70" ry="16" fill="#ffffff" opacity="0.7"/>` : ''}
${dancefloor}
${t.aura ? `<circle cx="500" cy="450" r="300" fill="${U('aura')}"/>` : ''}
${pedestal}
${trophy}
${stage.dome ? `<path d="M232 ${FLOOR_Y - 60}C240 520 320 380 420 318" stroke="#ffffff" stroke-opacity="0.45" stroke-width="12" stroke-linecap="round" fill="none"/>` : ''}
${frontBubbles}
<g fill="#ffffff" filter="${U('sparkleGlow')}">${sparkles}</g>
${title(56, 108, 64)}
${glassPill(768, 64, 176, 48)}
<text x="856" y="96" font-family="${FONT}" font-size="24" font-weight="800" text-anchor="middle" fill="${NAVY}">#${esc(b.id)}</text>
${glassPill(110, 872, 780, 92, t.aura ? GOLD[1] : null)}
${medal(162, 918, 34)}
<text x="216" y="910" font-family="${FONT}" font-size="30" font-weight="700" letter-spacing="-0.5" fill="${NAVY}">${esc(stage.name)}</text>
<text x="217" y="941" font-family="${FONT}" font-size="18" font-weight="600" fill="${NAVY}" fill-opacity="0.7">${esc(caption)}</text>
<text x="856" y="900" font-family="${FONT}" font-size="13" font-weight="800" text-anchor="end" letter-spacing="3" fill="${NAVY}" fill-opacity="0.6">SCORE</text>
<text x="856" y="944" font-family="${FONT}" font-size="42" font-weight="800" text-anchor="end" letter-spacing="-1" fill="${NAVY}">${esc(b.score ?? 0)}</text>
</svg>`;
}
