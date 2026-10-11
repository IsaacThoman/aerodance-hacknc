import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import Scene from './Scene.jsx';
import MainMenu from './menu/MainMenu.jsx';
import MenuDancers from './menu/MenuDancers.jsx';
import { loadSound, saveSound } from './menu/soundSettings.js';
import { loadWiiCursor, saveWiiCursor } from './menu/cursorSetting.js';
import { useLoopingMusic } from './audio/loopingMusic.js';
import { applySound, duckMenuMusic } from './audio/mixer.js';
import BattleScreen from './battle/BattleScreen.jsx';
import DebugPanel from './battle/DebugPanel.jsx';
import { api, createBattle, reportResult, seatTokens, startBattle, useBattle } from './battle/api.js';
import PhoneApp from './phone/PhoneApp.jsx';
import ConnectionPanel from './connect/ConnectionPanel.jsx';
import SongSelect from './game/SongSelect.jsx';
import GameScreen from './game/GameScreen.jsx';
import { COUNTDOWN_MS, GameSession, LATE_ALLOWANCE_MS } from './game/GameSession.js';
import { recordResults } from './game/bestScores.js';
import { PLAYERS, winnerOf } from './game/results.js';
import StageView from './stage/StageView.jsx';
import { DEFAULT_STAGE } from '../../packages/stages/catalog.js';
import { AndroidPoseSource } from './pose/AndroidPoseSource.js';
import { ReplayPoseSource, parseRecording } from './pose/ReplayPoseSource.js';
import { socket } from './socket.js';

function FixedRenderResolution() {
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);

  useLayoutEffect(() => {
    // Fiber tracks the displayed size for pointer events; keep the buffer at 4:3.
    gl.setSize(640, 480, false);
  }, [gl, size.width, size.height]);

  return null;
}

// /battle/<id> is a battle on this display; ?p=<token> (play links the bot texts) is a seat
// this display may report for. The token moves to sessionStorage and out of the URL.
const battleRoute = () => location.pathname.match(/^\/battle\/([a-z0-9]+)\/?$/)?.[1] ?? null;

async function claimPlayLink(id) {
  const token = new URLSearchParams(location.search).get('p');
  if (!token) return;
  history.replaceState(null, '', `/battle/${id}`);
  try {
    const { seat } = await api('POST', `/battles/${id}/seat`, { playerToken: token });
    seatTokens.add(id, { [seat]: token });
  } catch (err) {
    console.warn('play link not accepted:', err.message);
  }
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

// A battle's dance reports every seat this display holds a token for; a seat nobody
// danced (or that tracking never saw) reports zero so the battle settles straight away.
async function reportBattle(battle, results) {
  const tokens = seatTokens.get(battle.id);
  await Promise.all(battle.players.filter((p) => tokens[p.seat]).map((p) => {
    const r = results[p.seat];
    return reportResult(battle.id, tokens[p.seat], r ? {
      score: r.score,
      pops: r.judgements.perfect,
      sync: Math.round(Math.max(0, 1 - Math.abs(r.meanOffsetMs) / 150) * 100) / 100,
      flair: r.maxCombo,
    } : { score: 0, pops: 0, sync: 0, flair: 0 });
  }));
}

export default function App() {
  // Phones scanning a battle's QR code get the portrait phone view.
  return /^\/join(\/|$)/.test(location.pathname) ? <PhoneApp /> : <DisplayApp />;
}

function DisplayApp() {
  const [connected, setConnected] = useState(socket.connected);
  const [stats, setStats] = useState({ online: 0 });
  // 'menu' (MainMenu, opening on menuScreen), 'songs' (Song Select) or 'game' (a song).
  const [screen, setScreen] = useState('menu');
  const [menuScreen, setMenuScreen] = useState('main');
  // The menu screen actually showing; the Connect Client pill lives on Settings.
  const [menuShown, setMenuShown] = useState('main');
  const [playerCount, setPlayerCount] = useState(1);
  // The pose input: the Android client, or the webcam dummy (menus only, no tracking), or a
  // replay from the URL (?input=ghost) in place of both.
  const [inputMode, setInputMode] = useState('android');
  const [source] = useState(() => new AndroidPoseSource());
  const [replay] = useState(replaySource);
  const [connection, setConnection] = useState(source.view);
  const [replayView, setReplayView] = useState(replay?.view ?? null);
  const activeSource = replay ?? (inputMode === 'android' ? source : null);
  // The Connect Client card holds the menus while it's open.
  const [connectOpen, setConnectOpen] = useState(false);
  // Song Select's preview: the routine to dance, on which stage, and how that stage is doing.
  const [preview, setPreview] = useState(null);
  const [stageId, setStageId] = useState(DEFAULT_STAGE);
  const [stage, setStage] = useState({ showing: false, ready: false, stage: null, failed: false });
  const menuOpen = screen === 'menu';
  const selectedConnection = replay ? replayView : inputMode === 'webcam'
    ? { status: 'dummy', snapshot: null, message: 'Webcam dummy selected. Continue through the menus to test the flow.' }
    : connection;
  // The song being danced, its phase, and the results screen's reveal (StageView and
  // GameScreen both read it).
  const [game, setGame] = useState(null);
  const [gamePhase, setGamePhase] = useState(null);
  const resultsShow = useRef(null);
  const [sound, setSound] = useState(loadSound);
  const [wiiCursor, setWiiCursor] = useState(loadWiiCursor);
  const [battleId, setBattleId] = useState(battleRoute);
  // A battle on this display: 'lobby', 'songs' (Start pressed: pick the song), 'game' (the
  // song), then 'scoring' (results reported, the battle screen shows the outcome).
  const [battleStage, setBattleStage] = useState('lobby');
  const battle = useBattle(battleId);
  const battleRef = useRef(battle);
  battleRef.current = battle;

  const openBattle = useCallback((id) => {
    history.pushState(null, '', id ? `/battle/${id}` : '/');
    setMenuScreen('main');
    setBattleId(id);
    setBattleStage('lobby');
  }, []);
  const newBattle = useCallback(() => {
    createBattle(2).then(openBattle, (err) => console.error('could not start a battle:', err.message));
  }, [openBattle]);

  useEffect(() => {
    if (battleId) claimPlayLink(battleId);
    const onPop = () => { setBattleId(battleRoute()); setBattleStage('lobby'); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A link to a battle that doesn't exist lands on the menu.
  useEffect(() => {
    if (battle?.missing) {
      history.replaceState(null, '', '/');
      setBattleId(null);
    }
  }, [battle]);

  useEffect(() => {
    if (!replay) return undefined;
    const unsubscribe = replay.subscribe(setReplayView);
    replay.connect();
    return () => { unsubscribe(); replay.disconnect(); };
  }, [replay]);

  useEffect(() => {
    const unsubscribe = source.subscribe(setConnection);
    // Leaving the page releases the Android camera (it saves the board's battery).
    const disconnect = () => source.disconnect();
    window.addEventListener('pagehide', disconnect);
    return () => {
      window.removeEventListener('pagehide', disconnect);
      unsubscribe();
      source.disconnect();
    };
  }, [source]);

  const changeInputMode = useCallback((mode) => {
    source.disconnect();
    setInputMode(mode);
    source.setPlayerCount(playerCount).catch(() => {});
  }, [source, playerCount]);

  // One or two players picked: Android switches modes at its next stream boundary.
  const applyPlayerCount = useCallback((count) => {
    setPlayerCount(count);
    replay?.setPlayerCount(count);
    if (inputMode === 'android') source.setPlayerCount(count).catch(() => {});
  }, [inputMode, source, replay]);
  const choosePlayers = useCallback((count) => {
    if (inputMode === 'android' && source.view.configuring) return;
    applyPlayerCount(count);
    setScreen('songs');
  }, [inputMode, source, applyPlayerCount]);
  const leaveSongs = useCallback(() => {
    if (battleId) { setBattleStage('lobby'); return; }
    setMenuScreen('players');
    setScreen('menu');
  }, [battleId]);

  // Dance! on Song Select: a new GameSession for the bundle, on the song's stage.
  const startGame = useCallback((bundle) => {
    const session = new GameSession({ bundle, playerCount, source: activeSource, record: params.has('record') });
    resultsShow.current = null;
    setGame(session);
    setGamePhase(session.phase);
    setScreen('game');
    if (battleId) setBattleStage('game');
    duckMenuMusic(true);
    session.load();
  }, [playerCount, activeSource, battleId]);
  const endGame = useCallback(() => {
    setGame((session) => { session?.dispose(); return null; });
    setGamePhase(null);
    duckMenuMusic(false);
  }, []);
  const quitGame = useCallback(() => {
    endGame();
    setScreen('songs');
    if (battleId) setBattleStage('songs');
  }, [endGame, battleId]);
  const retryGame = useCallback(() => {
    const bundle = game?.bundle;
    endGame();
    if (bundle) startGame(bundle);
  }, [game, endGame, startGame]);
  const continueBattle = useCallback(() => {
    endGame();
    setScreen('menu');
    setBattleStage('scoring');
  }, [endGame]);

  // The session's phases drive the stage (live characters, results) and the battle.
  useEffect(() => {
    if (!game) return undefined;
    return game.onChange((session) => {
      setGamePhase(session.phase);
      const b = battleRef.current;
      if (session.phase === 'countdown' && battleId && b?.id === battleId && !b.startedAt) {
        const { song } = session.bundle;
        const danceMs = Math.round(COUNTDOWN_MS + song.playableEndMs - song.playableStartMs + LATE_ALLOWANCE_MS);
        startBattle(battleId, danceMs).catch((err) => console.warn('could not mark the battle started:', err.message));
      }
      if (session.phase !== 'results') return;
      const results = session.results.map((r, i) => ({ ...PLAYERS[i], ...r }));
      const best = battleId ? null : recordResults(session.bundle.song.songId, session.playerCount, session.results);
      resultsShow.current = { key: `${session.bundle.song.songId}|${performance.now()}`, start: performance.now() / 1000 + 0.3, results, winner: winnerOf(results), best };
      if (session.recordingText) download(`${session.bundle.song.songId}-poses.ndjson`, session.recordingText);
      if (battleId && b?.id === battleId && b.status === 'open') {
        reportBattle(b, session.results).catch((err) => console.error('battle results could not be reported:', err.message));
      }
    });
  }, [game, battleId]);

  useEffect(() => { saveSound(sound); applySound(sound); }, [sound]);
  useEffect(() => { saveWiiCursor(wiiCursor); }, [wiiCursor]);
  // "Pod Lounge" loops under the aero background as the menu music (Settings: Master,
  // Music, Menu music, Mute all).
  useLoopingMusic('/music/pod-lounge.mp3', 'menuMusic');

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('stats', setStats);
    // The socket may have connected before these listeners were added.
    setConnected(socket.connected);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('stats', setStats);
    };
  }, []);

  const inBattleSong = !!battleId && (battleStage === 'songs' || battleStage === 'game');
  const songsOpen = screen === 'songs' && (!battleId || battleStage === 'songs');
  const gameRoutine = useMemo(() => game?.routine() ?? null, [game]);
  // The players' own characters, while the song is on.
  const liveDancers = useMemo(() => (game && ['countdown', 'playing', 'paused', 'finishing'].includes(gamePhase) ? {
    playerCount: game.playerCount,
    livePose: (id, now) => game.livePose(id, now),
    calibration: (id) => game.live[id]?.calibration ?? null,
  } : null), [game, gamePhase]);

  return (
    <div className={`canvas-frame display${wiiCursor ? ' wii-cursor' : ''}`}>
      <Canvas dpr={1} flat camera={{ fov: 66, near: 0.3, far: 6500 }}>
        <FixedRenderResolution />
        <Scene paused={stage.showing} />
        <StageView
          active={(songsOpen && !!preview) || screen === 'game'}
          stageId={stageId}
          routine={game ? gameRoutine : preview}
          live={liveDancers}
          results={gamePhase === 'results' ? resultsShow : null}
          onState={setStage}
        />
        <MenuDancers visible={(menuOpen || songsOpen || (!!battleId && !inBattleSong)) && !stage.showing} />
        <MainMenu
          visible={menuOpen && !battleId}
          blocked={connectOpen}
          initialScreen={menuScreen}
          onStart={choosePlayers}
          onBattle={newBattle}
          onScreenChange={setMenuShown}
          sound={sound}
          onSoundChange={setSound}
          wiiCursor={wiiCursor}
          onWiiCursorChange={setWiiCursor}
        />
        <SongSelect
          visible={songsOpen}
          blocked={connectOpen}
          playerCount={playerCount}
          connection={selectedConnection}
          onBack={leaveSongs}
          onOpenConnect={() => setConnectOpen(true)}
          stageId={stageId}
          stageState={stage}
          onStageChange={setStageId}
          onPreviewChange={setPreview}
          onDance={startGame}
        />
        <GameScreen
          visible={screen === 'game' && !!game}
          blocked={connectOpen}
          session={game}
          results={resultsShow}
          battle={!!battleId}
          onQuit={quitGame}
          onRetry={retryGame}
          onContinue={continueBattle}
        />
        <BattleScreen
          visible={!!battleId && !inBattleSong}
          battle={battle}
          playing={battleStage === 'scoring'}
          onPlay={() => {
            // Battles are two dancers: pick the song, then dance it.
            applyPlayerCount(2);
            setScreen('songs');
            setBattleStage('songs');
          }}
          onBack={() => (battleStage === 'scoring' ? setBattleStage('lobby') : openBattle(null))}
          onRematch={newBattle}
          onMenu={() => openBattle(null)}
        />
        <DebugPanel battle={battleId ? battle : null} />
        {/* Song Select's player slots can also open the card, so it stays up while open. */}
        <ConnectionPanel
          visible={(!battleId || inBattleSong) && ((menuOpen && menuShown === 'settings') || connectOpen)}
          open={connectOpen}
          onOpenChange={setConnectOpen}
          source={source}
          connection={selectedConnection}
          inputMode={inputMode}
          onInputModeChange={changeInputMode}
        />
      </Canvas>
      <div className="hud">
        <div>
          <span className={`status ${connected ? 'online' : ''}`} />
          {connected ? 'Server online' : 'Server offline'}
        </div>
        <div>online: {stats.online}</div>
      </div>
    </div>
  );
}
