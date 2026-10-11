import { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PMREMGenerator } from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import Character from '../../../temp/frutiger-character/client/src/Character.jsx';
import modelUrl from '../../../temp/frutiger-character/client/public/models/aero-character.glb?url';
import { DEFAULT_SOUND } from '../menu/soundSettings.js';
import { sampleSong } from '../../../packages/pose/song.js';

class PreviewBoundary extends Component {
  state = { failed:false };
  static getDerivedStateFromError() { return { failed:true }; }
  render() { return this.state.failed ? <p role="alert">Character preview could not load.</p> : this.props.children; }
}
function Environment() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    camera.lookAt(0, 1.5, 0);
    const generator = new PMREMGenerator(gl), room = new RoomEnvironment();
    const target = generator.fromScene(room, .04); scene.environment = target.texture;
    room.dispose(); generator.dispose();
    return () => { scene.environment = null; target.dispose(); };
  }, [gl, scene, camera]);
  return null;
}
function Actor({ bundle, track, audio, playerCount }) {
  const poseRef = useRef(null);
  const appearance = useMemo(() => ({ color:track.playerId === 0 ? '#078fff' : '#b86bff', gloss:85, accessory:'None' }), [track.playerId]);
  useFrame(() => {
    const time = (audio.current?.currentTime ?? bundle.song.playableStartMs / 1000) * 1000;
    poseRef.current = sampleSong(bundle, time, playerCount).poses.find(p => p.playerId === track.playerId) ?? null;
  }, -1);
  const x = playerCount === 1 ? 0 : track.playerId === 0 ? -1.8 : 1.8;
  // Match the studio and menu playback orientation, preserving player lanes.
  return <group position={[x,0,0]} scale={[-1,1,1]}><Character url={modelUrl} poseRef={poseRef} calibration={track.calibration} appearance={appearance} /></group>;
}
export default function SongPreview({ bundle, playerCount, sound = DEFAULT_SOUND, onBack }) {
  const audio = useRef(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const url = URL.createObjectURL(bundle.audio); setAudioUrl(url);
    const element = audio.current;
    const pauseHidden = () => { if (document.hidden) element?.pause(); };
    let frame;
    const tick = () => {
      if (element && !element.paused && element.currentTime * 1000 >= bundle.song.playableEndMs) {
        element.pause();
        if (element.currentTime * 1000 > bundle.song.playableEndMs) element.currentTime = bundle.song.playableEndMs / 1000;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    document.addEventListener('visibilitychange', pauseHidden);
    return () => { element?.pause(); cancelAnimationFrame(frame); URL.revokeObjectURL(url); document.removeEventListener('visibilitychange', pauseHidden); };
  }, [bundle]);
  useEffect(() => {
    if (!audio.current) return;
    const volume = sound.master * sound.music;
    audio.current.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : .64;
    audio.current.muted = Boolean(sound.muted);
  }, [sound]);
  function boundTime() {
    const element = audio.current;
    if (!element) return;
    const start = bundle.song.playableStartMs / 1000, end = bundle.song.playableEndMs / 1000;
    if (element.currentTime < start) element.currentTime = start;
    if (element.currentTime >= end) { element.pause(); if (element.currentTime > end) element.currentTime = end; }
  }
  return <>
    <div className="panel-heading"><button onClick={onBack}>← Songs</button><span>{playerCount} player preview</span></div>
    <h1 id="song-heading">{bundle.song.title}</h1><p>{bundle.song.artist}</p>
    <div className="song-character-preview"><PreviewBoundary><Canvas dpr={1} camera={{ position:[0,3,11], fov:36 }}>
      <color attach="background" args={['#123e60']} /><Environment />
      <hemisphereLight args={['#dcffff','#27647d',1.8]} /><directionalLight position={[-3,6,5]} intensity={3} />
      <Suspense fallback={null}>{bundle.choreography.tracks.slice(0,playerCount).map(track => <Actor key={track.playerId} bundle={bundle} track={track} audio={audio} playerCount={playerCount} />)}</Suspense>
    </Canvas></PreviewBoundary></div>
    <audio aria-label="Song preview audio" ref={audio} src={audioUrl ?? undefined} controls preload="metadata" onLoadedMetadata={() => { audio.current.currentTime = bundle.song.playableStartMs / 1000; }}
      onPlay={() => { if (audio.current.currentTime >= bundle.song.playableEndMs / 1000) audio.current.currentTime = bundle.song.playableStartMs / 1000; }}
      onTimeUpdate={boundTime} onSeeking={boundTime} onError={() => setError('This browser could not decode the song audio.')} />
    {error && <p role="alert">{error}</p>}
    <p className="preview-note">Music and reference choreography preview · scoring and countdown are still in development.</p>
  </>;
}
