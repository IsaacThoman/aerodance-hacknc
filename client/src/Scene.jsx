import AeroWorld from './aero/AeroWorld.jsx';

export default function Scene({ paused = false }) {
  return <AeroWorld speed={1} paused={paused} />;
}
