# Main menu mocks

Six temporary Frutiger Aero main-menu variations for comparing directions. Everything, including the menus, is rendered in-engine (no DOM UI) at the main app's fixed 640×480 buffer, stretched to 16:9 with pixelated scaling. All geometry, textures and UI are procedural; there are no asset files.

| Key | Hash | Scene | Menu style |
| --- | --- | --- | --- |
| 1 | `#lagoon` | Aqua Lagoon: half-underwater view of a reef with fish, dolphins, a turtle and jellyfish, islands and a lighthouse above | Floating bubble buttons that pop |
| 2 | `#galaxy` | Starlight Galaxy: Mario Galaxy–style planetoids, launch star, star bits, comet | Galaxy map list; hovering an entry flies the camera to its planet |
| 3 | `#ecocity` | Eco Metropolis: glass eco-city on a bay with monorail, pods, blimp, turbines | Vista glass sidebar with clock, weather and now-playing gadgets |
| 4 | `#aurora` | Aurora Lake: aurora over a mirror lake, snowy mountains, glass dome cabin | PS3 XMB-style cross menu |
| 5 | `#meadow` | Breezy Meadow: Bliss-style hills with wind-swept grass, gazebo, balloon | Wii channel grid with clock |
| 6 | `#skystage` | Cloud Stage: golden-hour stage above the clouds with a beat-synced dancer | Rhythm-game home with DANCE! orb and song carousel |

Switch with the in-engine switcher at the bottom, ← / →, or 1–6. Clicking the logo sends the shared `spin` event, so the logo spins for every connected player. Menu buttons only animate; they don't navigate anywhere.

## View

Production and PR previews serve the mocks at `/menu-mocks/` (for example `/menu-mocks/#galaxy`). The root `npm run build` writes them to `dist/menu-mocks/`.

For development, from the repository root:

```sh
npx vite --config temp/menu-mocks/vite.config.js
```

Open http://localhost:5175. Without the main server on port 3000 the online badge reads "offline" and the logo spins locally only.

## Layout

All code lives in `client/src/menu/`:

- `MenuApp.jsx`: scene registry host, keyboard/hash switching, white transition veil.
- `post.jsx`: render pipeline. The world renders to a HalfFloat MSAA target, then UnrealBloom, a vignette/saturation grade and tone mapping; the HUD draws on top unprocessed. Scenes tune it through `meta.post`.
- `hud.jsx`: orthographic HUD layer in virtual 1280×720 px (origin at center), via an R3F portal.
- `ui/`: canvas-drawn glossy UI kit (`UIPlane`, `UIButton`, gel/glass/orb/bubble/icon drawing, `Logo`, switcher and online badge).
- `shared/`: `SceneCamera`, sky dome, cloud billboards, GLSL noise, seeded random, 118 bpm beat clock.
- `scenes/<id>/`: one folder per variation; each exports `meta` and a default component.

Cameras project at 16:9 into the 4:3 buffer so proportions are correct after the stretch (anamorphic, like Wii widescreen). The main app's camera is unchanged.

In dev, `window.__aeroStats` reports world draw calls and triangles. All six scenes measured about 60 FPS on Apple Silicon in Chrome, with 48–136 draw calls per frame. Eco Metropolis is the heaviest at about 825k triangles.
