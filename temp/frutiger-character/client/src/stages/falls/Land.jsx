import { useDisposable } from '../shared/hooks.js';
import { buildMeadowGeometry, buildMesaGeometry, buildMountainGeometry, buildValleyGeometry } from './landGeometry.js';
import { LAND_KIND, makeLandMaterial } from './landMaterial.js';

export function Meadow() {
  const geometry = useDisposable(buildMeadowGeometry);
  const material = useDisposable(() => makeLandMaterial(LAND_KIND.meadow));
  return <mesh geometry={geometry} material={material} />;
}

export function Valley() {
  const geometry = useDisposable(buildValleyGeometry);
  const material = useDisposable(() => makeLandMaterial(LAND_KIND.valley));
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}

export function Mesas() {
  const geometry = useDisposable(buildMesaGeometry);
  const material = useDisposable(() => makeLandMaterial(LAND_KIND.mesa));
  return <mesh geometry={geometry} material={material} />;
}

export function Mountains() {
  const near = useDisposable(() => buildMountainGeometry());
  const far = useDisposable(() => buildMountainGeometry({ z0: -1800, z1: -2500, peak: 330, seed: 21, x0: -3400, x1: 3400 }));
  const material = useDisposable(() => makeLandMaterial(LAND_KIND.mountain, 0.72));
  return (
    <>
      <mesh geometry={near} material={material} frustumCulled={false} />
      <mesh geometry={far} material={material} frustumCulled={false} />
    </>
  );
}
