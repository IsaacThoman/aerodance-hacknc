export const MEDIAPIPE_VERSION = '1.1.0';
export const ASSET_PATH = `pose-assets/mediapipe-${MEDIAPIPE_VERSION}`;
export const MODELS = [
  { id: 'lite', label: 'Lite', description: 'Fastest option · start here', bytes: 5777746, sha256: '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a' },
  { id: 'full', label: 'Full', description: 'Balanced quality and speed', bytes: 9398198, sha256: '5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1' },
  { id: 'heavy', label: 'Heavy', description: 'More demanding · try on a capable computer', bytes: 30664242, sha256: '64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b' },
].map(model => ({ ...model, file: `pose_landmarker_${model.id}.task`, url: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${model.id}/float16/1/pose_landmarker_${model.id}.task` }));
export function poseModel(id) {
  const model = MODELS.find(model => model.id === id);
  if (!model) throw Error('Choose Lite, Full, or Heavy');
  return model;
}
