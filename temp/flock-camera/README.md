# Photo-referenced Flock Falcon camera

A detailed, editable reconstruction of the older, elongated Flock camera in the supplied photographs: black pole, rounded housing, wraparound sun hood, six-LED optical cluster, adjustable mount, dual solar panel, two under-panel equipment enclosures, and external wiring.

## Deliverables

- `assets/flock-camera.blend`: editable Blender 4.5 scene, organized into collections for housing, optics, mounts, solar panels, batteries, cables, and fasteners. Includes presentation lights and eight named camera views. Cable curves, text, and bevel modifiers remain editable.
- `client/public/models/flock-camera.glb`: self-contained, full-size portable assembly, with named mesh parts and PBR materials. Contains no presentation floor, lights, or cameras. Use in Three.js, Blender, or other glTF-compatible tools.
- `assets/renders/`: full pole, assembly detail, optics, rear hardware, solar surface, a low angle matching the supplied photograph, and front/profile views for checking the corrected body proportions.
- `assets/model-stats.json`: evaluated geometry counts for the current build.
- `scripts/build-model.py`: reproducible model generator; no third-party models, textures, or downloaded geometry are needed.
- `client/`: standalone orbit viewer with close-up views, wireframe, component visibility controls, and GLB download.

## Low-poly version

`assets/flock-camera-low.blend` and `client/public/models/flock-camera-low.glb` provide a separate lightweight assembly at the same scale and with the corrected body proportions. It has **16,850 triangles in 44 meshes**, compared with 421,670 triangles in 506 meshes for the detailed version: **96% fewer triangles**. The GLB is about 515 KiB, compared with 8.1 MiB.

The low-poly version keeps the hollow pole, body, open-bottom hood, six LEDs, lens, logo, solar cells, batteries, mounting hardware, and main cable routes. It uses fewer curve/cylinder segments and single-segment edge radii; screw threads, washers, clamp perforations, tiny connector ribs, printed lettering, barcodes, and solar collector lines are omitted. Compatible parts are combined by material and parent to reduce mesh count. Camera, panel, and battery pivots remain separate, and the hood remains independently hideable. Curves and modifiers are baked into editable meshes in this Blender variant.

Use **Model detail → Low poly** in the viewer to compare versions without changing the viewpoint. Wireframe and visibility settings persist across the switch, and **Download GLB** downloads the selected version. Low-poly presentation images are `assets/renders/assembly-low.png`, `optics-low.png`, and `side-low.png`; its counts are in `assets/model-stats-low.json`.

Rebuild only the low-poly assets with:

```sh
FLOCK_LOD=low blender -b -t 8 -P temp/flock-camera/scripts/build-model.py
```

## World-use version

`assets/flock-camera-world.blend` and `client/public/models/flock-camera-world.glb` are the smaller placement LOD: **991 triangles, 9 meshes, 4 untextured materials**, and a **48,844-byte GLB**. This is about **94% fewer triangles** than the 16,850-triangle version. It preserves the revised body/hood silhouette, six-light optical layout, logo, panel cells, pole, and basic mounts. Per the user's request, this version has **no external wire or under-panel battery packs**. Flat layered optical shapes replace detailed lenses/reflectors; mounting hardware is reduced to simple blocks and bands. It is intended for ordinary world placement rather than extreme close-ups.

Choose **Model detail → World LOD**, or open <http://localhost:5176/?detail=world>. The viewer retains all three versions and downloads whichever is selected. Battery visibility is disabled for World LOD because it has no batteries. Its Blender file keeps component pivots and the existing studio, while its portable GLB excludes the studio. Renders are `assets/renders/assembly-world.png`, `optics-world.png`, and `side-world.png`.

Rebuild with:

```sh
blender -b -t 8 -P temp/flock-camera/scripts/build-world.py
```

This builder uses the existing `assets/flock-camera-low.blend` only for the presentation studio. It constructs fresh simplified geometry and writes separate files. `FLOCK_RENDER=0` skips renders.

For large Three.js populations, `client/world-instances.js` provides material-batched instancing:

```js
import { Matrix4 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createFlockInstances, disposeFlockInstances } from './world-instances.js';

const { scene: source } = await new GLTFLoader().loadAsync('/models/flock-camera-world.glb');
const transforms = positions.map(([x, y, z]) => new Matrix4().makeTranslation(x, y, z));
const population = createFlockInstances(source, transforms);
scene.add(population);
// Later, when removing this population:
// disposeFlockInstances(population);
```

Transforms use glTF's **Y-up meters**. The helper bakes component transforms into four shared material geometries and creates four `InstancedMesh` batches, with computed culling bounds. Shadows are disabled on these batches. It is intended for static placements of this untextured World LOD; source materials remain shared and are not disposed by the helper. Instance the model in spatial regions for useful culling, and use the more detailed variants only nearby. One global batch has a global bounding volume; it does not cull individual poles automatically.

The World LOD passes Khronos validation with zero errors/warnings. Checks confirm that material merging preserves the exact vertex bounds, 1,000 instance transforms are retained, four material batches are produced, and owned geometry is disposed. A thousand copies contain **991,000 triangles** before visibility/shadow passes. These are geometry and batching checks, not a target-device FPS guarantee.

Blender uses **meters, Z up**, with the pole at the origin and the camera facing negative Y. GLB uses the glTF convention **meters, Y up**. The physical assembly is separate from the studio collection. No app gameplay or menus were changed.

Presentation PNGs in `assets/renders/` are generated locally and are not tracked. Rebuild the corresponding model to produce them; use `FLOCK_RENDER=0` to regenerate geometry only. Viewer build output, Blender backups, downloaded references, and browser verification screenshots are also excluded from version control.

## Inspect interactively

From the repository root:

```sh
npm ci
npx vite --config temp/flock-camera/vite.config.js
```

Open <http://localhost:5176>. Drag to orbit, scroll to zoom, and right-drag to pan. View buttons frame the full pole, camera optics, body front/profile, rear brackets, or solar cells. Hide the camera hood to inspect the housing underneath. Hiding the solar assembly also hides its attached battery boxes.

To produce a standalone viewer build:

```sh
npx vite build --config temp/flock-camera/vite.config.js --base=./
python3 -m http.server 8086 --directory temp/flock-camera/dist
```

## Rebuild

```sh
blender -b -t 8 -P temp/flock-camera/scripts/build-model.py
```

The generator saves the editable `.blend`, exports the GLB, and renders the eight presentation views. To regenerate geometry without rendering:

```sh
FLOCK_RENDER=0 blender -b -t 8 -P temp/flock-camera/scripts/build-model.py
```

Blender Cycles uses Metal on supported Macs and falls back to CPU. Small-scale plastic surface grain is procedural in Blender; the GLB retains portable base color, metallic, roughness, and coat values. Geometry such as the solar collector lines, LED reflectors, seals, cable ribs, clamp slots, and exposed screw threads is modeled explicitly rather than drawn onto textures.

## Reference and accuracy notes

The user's initial photograph is the primary reference for the installation silhouette and component placement. The subsequent IMG_0507–IMG_0511 front, profile, and three-quarter photographs are the primary references for the revised body: wider and flatter hood arch, fuller lower housing, shallower front-to-back depth, curved hood cutaway, smaller optical aperture relative to the face, and larger/higher logo. Their proportions supersede the first draft's estimated housing shape; absolute dimensions remain estimates because no scale measurement is supplied. Additional references were used to resolve the optical array, back cover, clamps, and under-panel hardware:

1. [Joseph Morin — Flock Neighborhood Security Cameras](https://josephmorindesign.com/flock-security-cameras/): original industrial designer's front/three-quarter product photographs. Used for the six-LED layout, teardrop sensor insert, taper, open-bottom sun hood, and circular logo variant.
2. [Flock product photograph](https://images.prismic.io/flock-safety/41bb86bb-bc78-4a25-90fd-c933560ed9b1_falcon1.png?auto=compress%2Cformat&h=615&rect=1%2C0%2C730%2C615&w=730): older Falcon appearance.
3. [County of San Diego — RFB 10493, Flock installation material](https://www.sandiegocounty.gov/content/dam/sdc/purchasing/docs/RFB_10493_Abstract.pdf): PDF pages 41 and 45–49. Photographs show camera rear connectors, ball mount, hose clamps, top mounting sleeve, equipment packs, and cable routing. The older spec lists an 8.75-inch camera length and 14-by-21-inch solar panels.
4. [Flock Safety implementation guide](https://www.flocksafety.com/implementation-guide): standard 12-foot above-grade pole height.
5. [Los Altos Hills — ALPR camera photograph](https://www.losaltoshills.ca.gov/455/Automatic-License-Plate-Readers-ALPR): front optical arrangement.
6. [Grandview Independent — installed camera close-up](https://www.grandviewindependent.com/rpd-reporting-success-with-license-plate-readers/): under-panel rails, sleeve set screws, silver clamp bands, swivel hardware, and keeper clip.

### Modeled scale

| Component | Dimensions / setting | Confidence |
| --- | --- | --- |
| Above-grade pole | 3.6576 m / 12 ft | Published standard; actual photographed height is not measurable |
| Pole outer diameter | 0.073025 m / 2.875 in | Nominal Flock pole diameter; consistent with photo proportions |
| Camera body | About 222 × 83 × 71 mm, excluding hood | Published nominal length; width/depth estimated from supplied front/profile photographs |
| Camera faceplate | About 206 × 73 mm | Proportion estimate from IMG_0507 |
| Camera hood | About 105 mm wide, 106 mm deep; complete camera silhouette about 231 mm tall | Proportion estimate from IMG_0507–IMG_0511 |
| Dual panel assembly | 711 × 540 × 31 mm | Based on two nominal 14 × 21 in panels |
| Panel tilt | 16° | Estimated to match supplied photo; not an installation specification |
| Camera aim | 7° downward from horizontal | User-requested downward aim; independently adjustable from panel tilt |
| Battery box, each | About 148 × 210 × 142 mm including lid | Photographic estimate |

This is a **visual reconstruction, not manufacturer CAD or a fabrication drawing**. The visible form is based on reference photographs; unseen enclosure details, exact wall thicknesses, panel cell layout, cable lengths, and mounting clearances are inferred. Reference images depict more than one hardware revision; this model follows the circular logo and black under-panel enclosures in the supplied image. There are no invented internal electronics or ground flange. Inventory labels contain fictional identification text.

Downloaded reference photographs and the source attachment are not bundled or committed.

## Verification

Run the reproducible geometry and instancing checks from the repository root:

```sh
node temp/flock-camera/scripts/check-models.mjs
npx vite build --config temp/flock-camera/vite.config.js --base=./
```

The current geometry counts are recorded in `assets/model-stats.json`. The revised export loads through Three.js's `GLTFLoader` and passes the Khronos glTF validator with zero errors and zero warnings. Informational messages about UV attributes unused by the untextured materials do not affect the model.

The saved Blender file retains metric units, eight presentation cameras, and editable cable/other curves. The standalone Vite viewer build includes the front/profile shortcuts; Vite reports its standard bundle-size advisory for the included Three.js runtime.

The low-poly GLB also loads through Three.js and passes Khronos validation with zero errors and zero warnings. The viewer's detail switch, component visibility, wireframe, and selected-version download were checked with both variants.
