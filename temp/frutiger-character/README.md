# Frutiger character prototype

Temporary, self-contained character studio and Three.js sanctuary. The main Aerodance app stays in the repository’s root `client/`; this experiment has its own source, assets, package manifest, and build output.

## Run

From the repository root:

```sh
npm --prefix temp/frutiger-character ci
npm --prefix temp/frutiger-character run dev
```

Open http://localhost:5174. The studio and game work without a backend. If the existing Aerodance Socket.IO server is running on port 3000, Dance also sends the shared `spin` event. Otherwise the UI displays Local session.

## What’s here

- `client/src/Character.jsx`: rig playback and the customizable, partially transparent glass material.
- `client/src/Scene.jsx`: garden, character movement, camera, and six-bubble collection game.
- `client/src/App.jsx` and `styles.css`: character studio, customization controls, animation controls, and responsive layout.
- `assets/aero-character.blend`: editable Blender model, seven-bone rig, and four animation actions.
- `client/public/models/aero-character.glb`: exported model used by the game.
- `scripts/build-character.py`: deterministic Blender generator for both asset files.
- `tests/character.test.js`: exported silhouette, limb count, skin weights, animation, movement, and appearance validation.

The character has a detached spherical head, rounded tapered torso, two spherical hands, two oval feet, and plain dark eyes. Colors, glass finish, name, and accessories are customizable and saved on the current device. Idle, Walk, Wave, and Dance use the exported skeletal animations.

In the sanctuary, use WASD, arrow keys, or the mobile directional pad to collect all six bubbles. Play again restarts the collection game.

## Validate and rebuild

```sh
npm --prefix temp/frutiger-character test
npm --prefix temp/frutiger-character run build
```

To regenerate the Blender and GLB assets, install Blender on PATH and run:

```sh
npm --prefix temp/frutiger-character run character:build
```

Build output stays in this folder’s ignored `dist/` directory. Blender backup files and raw browser evidence are not included.
