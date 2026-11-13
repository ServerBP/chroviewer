# Spider Slider Sticks

SpiderSliderSticks by qlulezz, from the supplied Unity 2019.3.15f1 bundle.
Select with `?saber=spider-slider-sticks`, `?saberModel=spider-slider-sticks`,
the cosmetics picker, or `settings.saberModel` in per-player compositor configuration.
Shared links preserve the selection through the existing viewer settings path.

## Assets and coordinates

The GLB retains all ten enabled renderers (five per hand), original indexed meshes,
normals, UVs and baked hierarchy transforms. The two disabled template renderers are
omitted. Unity X is mirrored, triangle winding reversed, and UV V flipped for glTF;
the existing custom-saber root rotation then puts the blade on viewer negative Z.
No mesh simplification or geometry substitution is applied.

The native trail runs from Z 0.695900022983551 to 1.000499963760376 and uses the
bundle's 512×512 `trails2.0 solid random` texture. The original bundle is retained
under `public/sabers/source/SpiderSliderSticks.saber`.

## Materials

- `Glow_mat_red` / `Glow_mat_blue`: BeatSaber/Unlit Glow, player color and bloom alpha
  0.75. No invented white core, pulse or color animation. The serialized `_Color2`,
  `_Freq`, `_Speed` and `_Bloom` fields are unused by that shader.
- `Fresnel`: BeatSaber/Standard, static white, metallic 0, smoothness 0.175,
  rim scale 5, rim power 1.29, ambient 0.075, light intensity 1. The port uses the
  renderer's environment prepass for the nine-tap screen reflection and lighting
  estimate. Unity's GrabPass contains full scene color; the prepass contains the
  environment lighting, so reflected scene details and BRDF highlights can differ.
  This avoids adding a full scene capture per saber and per compositor player.
  Bloom alpha stays zero; this surface does not take player colors.
- `TrailMat`: Legacy Shaders/Particles/Additive, `2 * tint * texture * vertexColor`,
  tint alpha 80/255, SrcAlpha/One blending, RGB-only writes (scene alpha preserved),
  no depth writes, both faces. Texture RGB
  and alpha are kept separate. Trail duration and smoothing remain viewer settings.

## Re-export

Requires Python and `UnityPy==1.25.4`:

```sh
python scripts/assets/export-spider-slider-sticks.py \
  public/sabers/source/SpiderSliderSticks.saber \
  public/sabers/models/spider-slider-sticks.glb \
  --trail public/sabers/textures/spider-slider-sticks-trail.png
```

The GLB material extras retain the original shader names, floats and colors for auditing.
