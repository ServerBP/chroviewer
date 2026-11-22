import {
  AddEquation,
  CustomBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  SrcAlphaFactor,
  ZeroFactor,
  type Material,
  type Object3D,
} from 'three';

import { MAIN_ONLY_LAYER } from '../mirror/planar-mirror';

/**
 * Blends the colour like any transparent material but leaves the frame's alpha alone: the bloom pass reads alpha as glow,
 * so analysis overlays (boxes, blades, wedges, markers) stay crisp lines instead of glowing like notes and sabers.
 */
export function withoutBloom<T extends Material>(material: T): T {
  material.transparent = true;
  material.blending = CustomBlending;
  material.blendEquation = AddEquation;
  material.blendSrc = SrcAlphaFactor;
  material.blendDst = OneMinusSrcAlphaFactor;
  material.blendEquationAlpha = AddEquation;
  material.blendSrcAlpha = ZeroFactor;
  material.blendDstAlpha = OneFactor;
  return material;
}

/** Keeps analysis drawings out of the floor's reflection: only the main view draws them */
export function mainViewOnly<T extends Object3D>(object: T): T {
  object.traverse((child) => {
    child.layers.set(MAIN_ONLY_LAYER);
  });
  return object;
}
