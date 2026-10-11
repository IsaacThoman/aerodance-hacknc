import { useEffect, useState } from 'react';

// Published songs will carry audio + two-track choreography. The silent menu
// capture remains a preview, rather than a playable/scorable catalog entry.
export default function SongSelect({ playerCount, connection, onBack }) {
  const [catalog, setCatalog] = useState({ status: 'loading', songs: [] });
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}songs/manifest.json`, { signal: controller.signal })
      .then(response => { if (!response.ok) throw Error('Song catalog could not load.'); return response.json(); })
      .then(data => {
        if (data.version !== 1 || !Array.isArray(data.songs)) throw Error('Song catalog format is unsupported.');
        setCatalog({ status: 'ready', songs: data.songs });
      })
      .catch(error => { if (error.name !== 'AbortError') setCatalog({ status: 'error', songs: [], message: error.message }); });
    return () => controller.abort();
  }, []);
  const snapshot = connection.snapshot;
  const dummy = connection.status === 'dummy';
  return (
    <section className="song-select glass-panel" aria-labelledby="song-heading">
      <div className="panel-heading"><button onClick={onBack}>← Back</button><span>{playerCount === 1 ? 'One Player' : 'Two Players'}</span></div>
      <h1 id="song-heading">Song Select</h1>
      <p className="song-intro">Find your rhythm. Follow the dancers.</p>
      <div className="player-readiness" aria-label="Player tracking" aria-live="polite">
        {Array.from({ length: playerCount }, (_, id) => {
          const detected = snapshot?.poses.some(pose => pose.playerId === id);
          return <div key={id} className={`player-slot ${detected ? 'detected' : dummy ? 'preview' : ''}`}><span>Player {id + 1}</span><strong>{dummy ? 'Preview ready' : detected ? 'Detected' : connection.status === 'connected' ? 'Step into view' : 'Connect Client'}</strong></div>;
        })}
      </div>
      {connection.status === 'connected' && connection.model === 'synthetic' && <p className="placement-cue">Synthetic test source · tracking is simulated.</p>}
      {dummy && <p className="placement-cue">Webcam dummy · menu testing enabled · camera capture and tracking are not implemented.</p>}
      {playerCount === 2 && !dummy && <p className="placement-cue">Stand in separate camera halves: player 1 on the left, player 2 on the right of the unmirrored camera image.</p>}
      <div className="catalog-state" role="status">
        {catalog.status === 'loading' ? 'Loading songs…' : catalog.status === 'error' ? catalog.message : catalog.songs.length === 0 ? <><strong>The first routine is on its way</strong><p>No playable songs have been published yet. Each routine needs music and choreography for both players.</p></> : <><strong>Routines are being prepared</strong><p>Song playback will be available once audio and choreography integration is complete.</p></>}
      </div>
      <a className="demo-link" href="/dance/">Watch the captured dance preview ↗</a>
      <p className="preview-note">Silent preview · two recorded dancers · no scoring</p>
    </section>
  );
}
