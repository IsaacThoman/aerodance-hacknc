import { Component, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { PCFShadowMap } from "three";
import Scene from "./Scene.jsx";
import { socket } from "./socket.js";
import {
  ACCESSORIES,
  COLORS,
  DEFAULT_CHARACTER,
  loadCharacter,
} from "./character.js";

function Icon({ name, size = 20, ...props }) {
  const paths = {
    sparkle: (
      <>
        <path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z" />
        <path d="m20 2 .7 2.3L23 5l-2.3.7L20 8l-.7-2.3L17 5l2.3-.7Z" />
      </>
    ),
    headphones: (
      <>
        <path d="M4 13v-2a8 8 0 0 1 16 0v2" />
        <rect x="3" y="11" width="5" height="9" rx="2" />
        <rect x="16" y="11" width="5" height="9" rx="2" />
      </>
    ),
    sprout: (
      <>
        <path d="M12 21V11M12 14C2 14 3 5 3 5s9-1 9 9ZM12 10c0-8 9-8 9-8s1 9-9 9" />
      </>
    ),
    flower: (
      <>
        <path d="M12 8C6-2 2 9 8 11c-11 2-3 12 2 6 2 10 11 3 6-2 11-1 5-11-1-7 4-10-7-9-3 0Z" />
        <circle cx="12" cy="12" r="2" />
      </>
    ),
    halo: (
      <>
        <ellipse cx="12" cy="7" rx="9" ry="4" />
        <path d="M7 16v3m10-3v3" />
      </>
    ),
    none: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m6 6 12 12" />
      </>
    ),
    arrow: (
      <>
        <path d="M4 12h16m-6-6 6 6-6 6" />
      </>
    ),
    reset: (
      <>
        <path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" />
      </>
    ),
    wave: (
      <>
        <path d="M6 12V6m4 5V3m4 8V4m4 8V7M6 10c-5-2-5 3-2 7 3 5 14 6 14-3v-3" />
      </>
    ),
    dance: (
      <>
        <circle cx="14" cy="4" r="2" />
        <path d="m5 6 5 4 5-1 5-4M12 10l-2 5-5 4m5-4 5 1 3 5" />
      </>
    ),
    idle: (
      <>
        <path d="M5 15c0-5 3-9 7-9s7 4 7 9c0 5-14 5-14 0Z" />
        <path d="M9 11v2m6-2v2" />
      </>
    ),
    walk: (
      <>
        <circle cx="14" cy="4" r="2" />
        <path d="m7 21 4-7 3 2 2 5M6 12l4-5 4 2 4 4m-7-5-1 6" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name] || paths.sparkle}
    </svg>
  );
}
class SceneBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="scene-error">
        The 3D scene couldn’t load. Check that WebGL is enabled, then{" "}
        <button onClick={() => location.reload()}>try again</button>.
      </div>
    ) : (
      this.props.children
    );
  }
}
export default function App() {
  const [appearance, setAppearance] = useState(loadCharacter);
  const [animation, setAnimation] = useState("Idle");
  const [playing, setPlaying] = useState(false);
  const [collected, setCollected] = useState([]);
  const [resetKey, setResetKey] = useState(0);
  const [moving, setMoving] = useState(false);
  const [saved, setSaved] = useState(true);
  const [connected, setConnected] = useState(socket.connected);
  const controls = useRef({});
  useEffect(() => {
    try {
      localStorage.setItem("aerodance.character", JSON.stringify(appearance));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }, [appearance]);
  useEffect(() => {
    const connect = () => setConnected(true);
    const disconnect = () => setConnected(false);
    const spin = () => setAnimation("Dance");
    socket.on("connect", connect);
    socket.on("disconnect", disconnect);
    socket.on("spin", spin);
    return () => {
      socket.off("connect", connect);
      socket.off("disconnect", disconnect);
      socket.off("spin", spin);
    };
  }, []);
  useEffect(() => {
    controls.current = {};
  }, [playing]);
  const update = (key, value) => setAppearance((a) => ({ ...a, [key]: value }));
  const act = (value) => {
    setAnimation(value);
    if (value === "Dance" && socket.connected) socket.emit("spin");
  };
  const collect = (i) =>
    setCollected((old) => (old.includes(i) ? old : [...old, i]));
  return (
    <main className={`app ${playing ? "is-playing" : ""}`}>
      <header className="topbar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPlaying(false);
          }}
          aria-label="Aerodance character studio"
        >
          <span className="brand-orb">a</span>
          <span>
            aero<span className="brand-light">dance</span>
            <small>A LITTLE WORLD OF POSSIBILITY</small>
          </span>
        </a>
        <nav aria-label="Main navigation">
          <button
            className={!playing ? "nav-active" : ""}
            onClick={() => setPlaying(false)}
          >
            Character studio
          </button>
          <button
            className={playing ? "nav-active" : ""}
            onClick={() => setPlaying(true)}
          >
            Sanctuary <span className="tiny-dot" />
          </button>
        </nav>
        <div className="session">
          <span className="status-dot" />
          {connected ? "Connected" : "Local session"}
        </div>
      </header>
      <div className="workspace">
        {!playing && (
          <aside className="studio">
            <div className="studio-heading">
              <span className="eyebrow">MAKE YOURSELF AT HOME</span>
              <h1>A little more you.</h1>
              <p>
                A drop of color. A splash of personality.
                <br />
                Meet your new little companion.
              </p>
            </div>
            <div className="section-label">
              <span>01</span>
              <label htmlFor="character-name">Say hello to</label>
            </div>
            <div className="name-field">
              <input
                id="character-name"
                value={appearance.name}
                onChange={(e) => update("name", e.target.value)}
                maxLength={20}
                placeholder="Your companion’s name"
              />
              <Icon name="sparkle" size={18} />
            </div>
            <div className="section-label">
              <span>02</span>
              <h2>Find your color</h2>
              <span className="value-label">
                {COLORS.find((c) => c.value === appearance.color)?.name}
              </span>
            </div>
            <div className="swatches" aria-label="Character color">
              {COLORS.map((c) => (
                <button
                  key={c.name}
                  aria-label={c.name}
                  title={c.name}
                  aria-pressed={appearance.color === c.value}
                  className={appearance.color === c.value ? "selected" : ""}
                  onClick={() => update("color", c.value)}
                  style={{ "--swatch": c.value }}
                >
                  {appearance.color === c.value ? "✓" : ""}
                </button>
              ))}
            </div>
            <div className="gloss-label">
              <label htmlFor="gloss">Glass finish</label>
              <span>{appearance.gloss}%</span>
            </div>
            <input
              className="gloss-slider"
              id="gloss"
              type="range"
              min="0"
              max="100"
              value={appearance.gloss}
              onChange={(e) => update("gloss", Number(e.target.value))}
            />
            <div className="range-captions">
              <span>Soft & frosted</span>
              <span>Crystal clear</span>
            </div>
            <div className="section-label accessory-label">
              <span>03</span>
              <h2>The finishing touch</h2>
            </div>
            <div className="accessories">
              {ACCESSORIES.map((a) => (
                <button
                  key={a}
                  onClick={() => update("accessory", a)}
                  aria-pressed={appearance.accessory === a}
                  className={appearance.accessory === a ? "selected" : ""}
                >
                  <Icon name={a.toLowerCase()} size={23} />
                  <span>{a}</span>
                  {appearance.accessory === a && <i>✓</i>}
                </button>
              ))}
            </div>
            <div className="studio-footer">
              <p>
                <span className="save-dot" />
                {saved
                  ? "Your look is saved on this device"
                  : "Storage unavailable · look saved for this visit"}
              </p>
              <button
                className="enter-button"
                onClick={() => {
                  setPlaying(true);
                  setAnimation("Idle");
                }}
              >
                Enter the sanctuary <Icon name="arrow" />
              </button>
              <button
                className="reset-button"
                onClick={() => setAppearance({ ...DEFAULT_CHARACTER })}
              >
                <Icon name="reset" size={13} /> Reset look
              </button>
            </div>
          </aside>
        )}
        <section
          className="viewport"
          aria-label="Interactive 3D character scene"
        >
          <SceneBoundary>
            <Canvas
              shadows={{ type: PCFShadowMap }}
              dpr={[1, 1.75]}
              camera={{ position: [0, 3.2, 7.8], fov: 40, near: 0.1, far: 150 }}
              gl={{ antialias: true, alpha: false }}
            >
              <Scene
                appearance={appearance}
                animation={animation}
                playing={playing}
                controls={controls}
                collected={collected}
                onCollect={collect}
                resetKey={resetKey}
                onMotion={setMoving}
              />
            </Canvas>
          </SceneBoundary>
          <div className="scene-top">
            <div className="location-badge">
              <span className="location-symbol">✳</span>
              <span>
                {playing ? "THE SANCTUARY" : "AQUA GARDENS"}
                <small>
                  {playing
                    ? "Take a breath. Take a little wander."
                    : "A good place to begin."}
                </small>
              </span>
            </div>
            <span className="scene-chip">
              <span className="tiny-dot" />
              {playing ? "FREE ROAM" : "LIVE PREVIEW"}
            </span>
          </div>
          {!playing && (
            <div className="drag-hint">
              <span>↔</span> Drag to meet every side
            </div>
          )}
          {playing && (
            <div className="quest glass">
              <span className="eyebrow">A LITTLE SCAVENGER HUNT</span>
              <h2>
                {collected.length === 6
                  ? "A pocket full of sunshine!"
                  : "Follow the floating bubbles"}
              </h2>
              <p>
                {collected.length === 6
                  ? "You found them all. Stay a while, or go again."
                  : "Wander around the garden and collect all six."}
              </p>
              <div className="quest-progress">
                {Array.from({ length: 6 }, (_, i) => (
                  <span
                    key={i}
                    className={i < collected.length ? "found" : ""}
                  />
                ))}
                <b>{collected.length} / 6</b>
              </div>
              {collected.length === 6 && (
                <button
                  onClick={() => {
                    setCollected([]);
                    setResetKey((k) => k + 1);
                  }}
                >
                  Play again <Icon name="reset" size={14} />
                </button>
              )}
            </div>
          )}
          <div className="character-caption">
            <span className="eyebrow">
              {playing ? "EXPLORING WITH" : "NICE TO MEET YOU, I’M"}
            </span>
            <h2>
              {appearance.name.trim() || "Bloop"}
              <span>✦</span>
            </h2>
            <p>
              {moving
                ? "One small step, one happy drop."
                : animation === "Dance"
                  ? "A little rhythm, a lot of joy."
                  : animation === "Wave"
                    ? "Sending a little good energy your way."
                    : "Made of water. Full of wonder."}
            </p>
          </div>
          <div className="actions glass" aria-label="Character animation">
            {["Idle", "Wave", "Dance", "Walk"].map((a) => (
              <button
                key={a}
                aria-pressed={animation === a}
                onClick={() => act(a)}
                className={animation === a ? "selected" : ""}
              >
                <Icon name={a.toLowerCase()} size={20} />
                <span>{a}</span>
              </button>
            ))}
          </div>
          {playing && (
            <>
              <button
                className="back-button glass"
                onClick={() => setPlaying(false)}
              >
                ← Back to studio
              </button>
              <div className="move-help">
                <kbd>W</kbd>
                <span>
                  <kbd>A</kbd>
                  <kbd>S</kbd>
                  <kbd>D</kbd>
                </span>
                <small>or arrow keys to move</small>
              </div>
              <div className="touch-controls" aria-label="Movement controls">
                {[
                  ["up", "↑"],
                  ["left", "←"],
                  ["down", "↓"],
                  ["right", "→"],
                ].map(([dir, label]) => (
                  <button
                    key={dir}
                    aria-label={`Move ${dir}`}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.currentTarget.setPointerCapture(e.pointerId);
                      controls.current[dir] = true;
                    }}
                    onPointerUp={() => (controls.current[dir] = false)}
                    onPointerCancel={() => (controls.current[dir] = false)}
                    onLostPointerCapture={() => (controls.current[dir] = false)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="scene-footnote">A brighter kind of everyday.</div>
        </section>
      </div>
      <footer className="bottom-bar">
        <span>
          <span className="tiny-dot" /> A tiny escape, just for you.
        </span>
        <span>
          BUILT FROM A LITTLE OPTIMISM <Icon name="sparkle" size={13} />
        </span>
      </footer>
    </main>
  );
}
