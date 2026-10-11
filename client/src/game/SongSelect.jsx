import { useEffect, useRef, useState } from 'react';
import { validateCatalog } from '../../../packages/pose/song.js';
import { loadSongBundle } from '../songs/loadBundle.js';
import SongPreview from './SongPreview.jsx';

// Published songs will carry audio + two-track choreography. The silent menu
// capture remains a preview, rather than a playable/scorable catalog entry.
export default function SongSelect({ playerCount, connection, sound, onBack }) {
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(null);
  const [loadError, setLoadError] = useState('');
  const pending = useRef(null);
  const catalogUrl = new URL(`${import.meta.env.BASE_URL}songs/manifest.json`, window.location.href).href;
  useEffect(() => () => pending.current?.abort(), []);
  async function chooseSong(entry) {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setLoading(entry.id); setLoadError('');
    try {
      const result = await loadSongBundle(entry, catalogUrl, { signal:controller.signal });
      if (!controller.signal.aborted) setBundle(result);
    } catch (error) { if (!controller.signal.aborted) setLoadError(error.message); }
    finally { if (!controller.signal.aborted) setLoading(null); }
  }
  const [catalog, setCatalog] = useState({ status: 'loading', songs: [] });
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}songs/manifest.json`, { signal: controller.signal })
      .then(response => { if (!response.ok) throw Error('Song catalog could not load.'); return response.json(); })
      .then(data => {
        validateCatalog(data);
        setCatalog({ status: 'ready', songs: data.songs });
      })
      .catch(error => { if (error.name !== 'AbortError') setCatalog({ status: 'error', songs: [], message: error.message }); });
    return () => controller.abort();
  }, []);
  const snapshot = connection.snapshot;
  const dummy = connection.status === 'dummy';
  return (
    <section className="song-select glass-panel" aria-labelledby="song-heading">
      {bundle ? <SongPreview sound={sound} bundle={bundle} playerCount={playerCount} onBack={() => setBundle(null)} /> : <>
      <div className="panel-heading"><button onClick={onBack}>← Back</button><span>{playerCount === 1 ? 'One Player' : 'Two Players'}</span></div>
      <h1 id="song-heading">Song Select</h1>
      <p className="song-intro">Find your rhythm. Follow the dancers.</p>
      <div className="player-readiness" aria-label="Player tracking" aria-live="polite">
        {Array.from({ length: playerCount }, (_, id) => {
          const detected = snapshot?.poses.some(pose => pose.playerId === id);
          return <div key={id} className={`player-slot ${detected ? 'detected' : dummy ? 'preview' : ''}`}><span>Player {id + 1}</span><strong>{dummy ? 'Preview ready' : detected ? 'Detected' : connection.status === 'initializing' ? 'Camera starting…' : connection.status === 'connected' ? 'Step into view' : ['connecting', 'reconnecting'].includes(connection.status) ? 'Connecting…' : 'Connect Client'}</strong></div>;
        })}
      </div>
      {connection.status === 'connected' && connection.model === 'synthetic' && <p className="placement-cue">Synthetic test source · tracking is simulated.</p>}
      {connection.status === 'initializing' && <p className="placement-cue" role="status">{connection.message}</p>}
      {dummy && <p className="placement-cue">Webcam dummy · menu testing enabled · camera capture and tracking are not implemented.</p>}
      {playerCount === 2 && !dummy && <p className="placement-cue">Stand in separate camera halves: player 1 on the left, player 2 on the right of the unmirrored camera image.</p>}
      <div className="catalog-state" role="status">
        {catalog.status === 'loading' ? 'Loading songs…' : catalog.status === 'error' ? catalog.message : catalog.songs.length === 0 ? <><strong>The first routine is on its way</strong><p>No playable songs have been published yet. Each routine needs music and choreography for both players.</p></> : <div className="song-list">{catalog.songs.filter(song => song.supportedPlayerCounts.includes(playerCount)).map(song => <button key={song.id} disabled={loading !== null} onClick={() => chooseSong(song)}><strong>{song.title}</strong><span>{song.artist} · {song.difficulty ?? 'Routine'}</span><span>{loading === song.id ? 'Loading bundle…' : 'Preview routine'}</span></button>)}</div>}
      </div>
      {loadError && <p role="alert">{loadError}</p>}
      <a className="demo-link" href="/dance/">Watch the captured dance preview ↗</a>
      <p className="preview-note">Silent preview · two recorded dancers · no scoring</p>
      </>}
    </section>
  );
}
