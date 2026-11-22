# SC Saber and SC Saber CC

Both Second Chance sabers are by KudneuS, as recorded in the supplied bundles.
The original `.saber` files are in `public/sabers/source/`.

| Saber       | ID            | Colors                                                                                |
| ----------- | ------------- | ------------------------------------------------------------------------------------- |
| SC Saber    | `sc-saber`    | Original pink left blade and white right blade, including trails                      |
| SC Saber CC | `sc-saber-cc` | Each player's replay/custom left and right colors on blades, screws, logos and trails |

Use `?saber=sc-saber` or `?saber=sc-saber-cc`. The canonical `saberModel` key,
JSON `settings` query parameter, cosmetics picker, saved settings and shared
cosmetics links use the same IDs.

For BeatKhana overlays, choose either saber in the overlay editor. The selection
is stored in `node.props.viewerSettings.saberModel` and sent as
`players[i].settings.saberModel` in `beatkhana:multiview-config`. The replay
compositor accepts the same per-player field in
`beatkhana:replay-compositor-config`. Each player retains independent materials
and colors; only immutable mesh data and textures are cached across players.

## Asset conversion

Both GLBs retain all six material submeshes per hand, 40,095 vertices and 73,316
triangles per hand, original normals and UVs, with baked local transforms. The
Unity editor's ±0.3 m LeftSaber/RightSaber preview offsets are excluded so each
mesh is centered at the replay grip. Unity X is mirrored, winding reversed, and
UV V flipped, matching the existing custom-saber loader's Y rotation.

Native trail endpoints are Z 0.10000000149011612 and 1.0045000314712524. Both
variants share the original 512×512 `trails2.0 solid random` texture and 32×32
`HologramLines` texture. The trail preserves the original 0.5×1 texture scale,
2× glow and 231/255 component multiplier. Duration, smoothing, visibility, width,
scale and grip adjustments continue through the viewer's existing controls.

## WebGL materials

The handles remain opaque gray. The blade/screw rim materials use the original
color powers (15 and 3) and Fresnel powers (2 and 3). Logos use the native repeating
line mask, 16× tiling and 0.05 scrolling speed, driven by replay song time even
when trails are hidden. The CC version binds the colored materials to the
appropriate player's hand; the regular version retains the serialized colors.

The source contains compiled Windows Shader Forge programs. The WebGL shaders
adapt the rim and hologram effects using the serialized properties and native
texture, and integrate them with ChroViewer's fog, tone mapping and bloom.
They are visual adaptations, not byte-for-byte ports of the compiled Unity
shaders; transparency, lighting and bloom can differ from Unity.

## Re-export and validation

Install `UnityPy==1.25.4` into a Python environment, then run:

```sh
python scripts/assets/export-sc-sabers.py
```

This regenerates both GLBs and both shared textures from the retained sources.
GLB material extras preserve original shader names, floats and colors for audit.
The exporter also prints source trail settings and grip-relative endpoints.

Regression tests parse the actual GLBs and check triangle counts, grip alignment,
material roles, native endpoints, fixed colors, independent per-player CC colors,
textures, URL aliases, per-player settings validation and shared replay links.
