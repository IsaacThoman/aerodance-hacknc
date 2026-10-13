import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import Scene from './Scene.jsx';
import MainMenu from './menu/MainMenu.jsx';
import MenuDancers from './menu/MenuDancers.jsx';
import { loadSound, saveSound } from './menu/soundSettings.js';
import { applySound, duckMenuMusic } from './audio/mixer.js';
import ConnectionPanel from './connect/ConnectionPanel.jsx';
import SongSelect from './game/SongSelect.jsx';
import GameScreen from './game/GameScreen.jsx';
import ResultsScreen from './game/ResultsScreen.jsx';
import { GameSession } from './game/GameSession.js';
import { recordResults } from './game/bestScores.js';
import { PLAYERS, winnerOf } from './game/results.js';
import StageView from './stage/StageView.jsx';
import { resolveStage } from '../../packages/stages/catalog.js';
import { PoseSourceController } from './pose/PoseSourceController.js';
import { ReplayPoseSource, parseRecording } from './pose/ReplayPoseSource.js';

function FixedRenderResolution() {
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);

  useLayoutEffect(() => {
    // Fiber tracks the displayed size for pointer events; keep the buffer at 4:3.
    gl.setSize(640, 480, false);
  }, [gl, size.width, size.height]);

  return null;
}

// ?input=ghost plays with an autoplay ghost that copies the routine (?ghostLagMs=300 dances
// late); ?input=recording&recording=<url> replays a pose recording. ?record downloads each
// song's live poses as a recording on the results screen.
const params = new URLSearchParams(location.search);
function replaySource() {
  const input = params.get('input');
  if (input === 'ghost') return new ReplayPoseSource({ mode: 'ghost', lagMs: Number(params.get('ghostLagMs')) || 0 });
  if (input !== 'recording' || !params.get('recording')) return null;
  const source = new ReplayPoseSource({ mode: 'recording' });
  fetch(params.get('recording')).then((r) => r.text()).then((text) => { source.recording = parseRecording(text); })
    .catch((err) => console.error('pose recording could not load:', err.message));
  return source;
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/x-ndjson' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  // 'menu' (MainMenu, opening on menuScreen), 'songs' (Song Select) or 'game' (a song).
  const [screen, setScreen] = useState('menu');
  const [menuScreen, setMenuScreen] = useState('main');
  // The menu screen actually showing; the Connect Client pill lives on Settings.
  const [menuShown, setMenuShown] = useState('main');
  const [playerCount, setPlayerCount] = useState(1);
  // The live webcam input, with optional URL replay.
  const [source] = useState(() => new PoseSourceController());
  const [replay] = useState(replaySource);
  const [connection, setConnection] = useState(source.view);
  const [replayView, setReplayView] = useState(replay?.view ?? null);
  const activeSource = replay ?? source;
  // The Connect Client card holds the menus while it's open.
  const [connectOpen, setConnectOpen] = useState(false);
  // Song Select's preview: the routine to dance, and how its stage is doing.
  const [preview, setPreview] = useState(null);
  const [stage, setStage] = useState({ showing: false, ready: false, stage: null, failed: false });
  const menuOpen = screen === 'menu';
  const selectedConnection = replay ? replayView : connection;
  // The song being danced, its phase, and the results screen's reveal (StageView and
  // GameScreen both read it).
  const [game, setGame] = useState(null);
  const [gamePhase, setGamePhase] = useState(null);
  const resultsShow = useRef(null);
  const [sound, setSound] = useState(loadSound);

  useEffect(() => {
    if (!replay) return undefined;
    const unsubscribe = replay.subscribe(setReplayView);
    replay.connect();
    return () => { unsubscribe(); replay.disconnect(); };
  }, [replay]);

  useEffect(() => {
    const unsubscribe = source.subscribe(setConnection);
    // Leaving the page releases the camera.
    const disconnect = () => source.disconnect();
    window.addEventListener('pagehide', disconnect);
    return () => {
      window.removeEventListener('pagehide', disconnect);
      unsubscribe();
      source.disconnect();
    };
  }, [source]);

  const choosePlayers = useCallback((count) => {
    if (source.view.configuring) return;
    setPlayerCount(count);
    replay?.setPlayerCount(count);
    source.setPlayerCount(count).catch(() => {});
    setScreen('songs');
  }, [source, replay]);
  const leaveSongs = useCallback(() => {
    setMenuScreen('players');
    setScreen('menu');
  }, []);

  // Dance! on Song Select: a new GameSession for the bundle, on the song's stage.
  const startGame = useCallback((bundle) => {
    const session = new GameSession({ bundle, playerCount, source: activeSource, record: params.has('record') });
    resultsShow.current = null;
    setGame(session);
    setGamePhase(session.phase);
    setScreen('game');
    duckMenuMusic(true);
    session.load();
  }, [playerCount, activeSource]);
  const endGame = useCallback(() => {
    setGame((session) => { session?.dispose(); return null; });
    setGamePhase(null);
    duckMenuMusic(false);
  }, []);
  const quitGame = useCallback(() => {
    endGame();
    setScreen('songs');
  }, [endGame]);
  const retryGame = useCallback(() => {
    const bundle = game?.bundle;
    endGame();
    if (bundle) startGame(bundle);
  }, [game, endGame, startGame]);

  // The session's phases drive the stage (live characters, results).
  useEffect(() => {
    if (!game) return undefined;
    return game.onChange((session) => {
      setGamePhase(session.phase);
      if (session.phase !== 'results') return;
      const results = session.results.map((r, i) => ({ ...PLAYERS[i], ...r }));
      const best = recordResults(session.bundle.song.songId, session.playerCount, session.results);
      resultsShow.current = { key: `${session.bundle.song.songId}|${performance.now()}`, start: performance.now() / 1000 + 0.3, results, winner: winnerOf(results), best };
      if (session.recordingText) download(`${session.bundle.song.songId}-poses.ndjson`, session.recordingText);
    });
  }, [game]);

  useEffect(() => { saveSound(sound); applySound(sound); }, [sound]);

  const songsOpen = screen === 'songs';
  const resultsVisible = screen === 'game' && gamePhase === 'results';
  const gameRoutine = useMemo(() => game?.routine() ?? null, [game]);
  // Every song dances on its own stage, picked in Dance Studio (Open Reef if unset or unknown).
  const stageId = resolveStage((game?.bundle ?? preview?.bundle)?.song.stage);
  // The players' own characters, while the song is on.
  const liveDancers = useMemo(() => (game && ['countdown', 'playing', 'paused', 'finishing'].includes(gamePhase) ? {
    playerCount: game.playerCount,
    livePose: (id, now) => game.livePose(id, now),
    calibration: (id) => game.live[id]?.calibration ?? null,
  } : null), [game, gamePhase]);

  return (
    <div className="canvas-frame display">
      <Canvas dpr={1} flat camera={{ fov: 66, near: 0.3, far: 6500 }}>
        <FixedRenderResolution />
        <Scene paused={stage.showing} />
        <StageView
          active={(songsOpen && !!preview) || screen === 'game'}
          orbiting={songsOpen && !!preview}
          stageId={stageId}
          routine={game ? gameRoutine : preview}
          live={liveDancers}
          results={resultsVisible ? resultsShow : null}
          onState={setStage}
        />
        <MenuDancers
          visible={(menuOpen || songsOpen) && !stage.showing}
          raised={songsOpen}
          solo={songsOpen && playerCount === 1}
        />
        <MainMenu
          visible={menuOpen}
          blocked={connectOpen}
          initialScreen={menuScreen}
          onStart={choosePlayers}
          onScreenChange={setMenuShown}
          sound={sound}
          onSoundChange={setSound}
        />
        <SongSelect
          visible={songsOpen}
          blocked={connectOpen}
          playerCount={playerCount}
          connection={selectedConnection}
          onBack={leaveSongs}
          stageState={stage}
          onPreviewChange={setPreview}
          onDance={startGame}
        />
        <GameScreen
          visible={screen === 'game' && !!game}
          blocked={connectOpen}
          session={game}
          onQuit={quitGame}
          onRetry={retryGame}
        />
        <ResultsScreen
          visible={resultsVisible}
          blocked={connectOpen}
          show={resultsShow}
          song={game?.bundle.song}
          onQuit={quitGame}
          onRetry={retryGame}
        />
        <ConnectionPanel
          visible={(menuOpen && menuShown === 'settings') || connectOpen}
          open={connectOpen}
          onOpenChange={setConnectOpen}
          source={source}
          connection={selectedConnection}
        />
      </Canvas>
    </div>
  );
}
