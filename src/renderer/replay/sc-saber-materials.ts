import {
  AddEquation,
  CustomBlending,
  DoubleSide,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  Vector3,
  type Material,
  type Texture,
} from 'three';

import type { Rgb } from '../../core/colors';
import type { FogUniforms } from '../bloomfog/pipeline';
import { linearColor, materialFogUniforms } from '../materials/shared';
import { ACES_CHUNK, FOG_CHUNK, OBJECT_VERT } from '../shaders/chunks';
import { SABER_TRAIL_VERT } from '../shaders/map-object-shaders';

export interface ScSaberSurface {
  kind: 'handle' | 'rim' | 'hologram';
  colorPower: number;
  fresnelPower: number;
  glow: number;
  lightDirection: Vector3;
}

export function readScSaberSurface(material: Material): ScSaberSurface {
  const floats: Record<string, number> = material.userData.unityFloats ?? {};
  const direction: { r: number; g: number; b: number } = material.userData.unityColors?._LightDir ?? {
    r: 0,
    g: -1,
    b: 0,
  };
  const shader: string = material.userData.unityShader ?? '';
  return {
    kind: shader === 'BeatSaber/Lit Glow' ? 'handle' : shader.endsWith('Hologram') ? 'hologram' : 'rim',
    colorPower: floats._ColorPower ?? floats._TintPower ?? 1,
    fresnelPower: floats._FresnelSize ?? floats._FresnelPower ?? 3,
    glow: floats._Glow ?? 0,
    lightDirection: new Vector3(-direction.r, direction.g, direction.b),
  };
}

// WebGL adaptation of the bundle's MainSaber and EmmisionTriangleHologram
// materials. Keep the original geometry, rim settings and scrolling line mask.
const SURFACE_FRAG = /* glsl */ `
uniform vec3 _Color;
uniform float _ColorPower;
uniform float _FresnelPower;
uniform float _Glow;
uniform vec3 _LightDir;
uniform sampler2D _HologramTexture;
uniform float _Time;
uniform float _FogStartOffset;
uniform float _FogScale;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec4 vScreenPos;
varying vec2 vUv;
${ACES_CHUNK}
${FOG_CHUNK}
void main() {
  vec3 normal = normalize(vWorldNormal);
  vec3 view = normalize(cameraPosition - vWorldPos);
  float rim = pow(1.0 - abs(dot(normal, view)), _FresnelPower);
  vec3 color;
  float bloom = _Glow;
  #ifdef SC_HANDLE
    float light = max(dot(normal, normalize(-_LightDir)), 0.0);
    color = _Color * (1.0 + light);
  #elif defined(SC_HOLOGRAM)
    // UV V was flipped for glTF; undo it for Unity's scrolling texture.
    vec2 uv = vec2(vUv.x, 1.0 - vUv.y) * 16.0 + vec2(0.0, _Time * 0.05);
    float lines = texture2D(_HologramTexture, uv).r;
    float signal = clamp(lines + rim, 0.0, 1.0);
    color = _Color * _ColorPower * signal;
    bloom *= signal;
  #else
    color = _Color * _ColorPower * rim;
  #endif
  gl_FragColor = applyChroFog(vec4(chroToneMap(color), bloom), vScreenPos, vWorldPos, _FogStartOffset, _FogScale);
  #include <colorspace_fragment>
}
`;

export function createScSaberMaterial(fog: FogUniforms, color: Rgb, surface: ScSaberSurface, hologram: Texture) {
  const handle = surface.kind === 'handle';
  return new ShaderMaterial({
    defines: handle ? { SC_HANDLE: 1 } : surface.kind === 'hologram' ? { SC_HOLOGRAM: 1 } : {},
    vertexShader: OBJECT_VERT,
    fragmentShader: SURFACE_FRAG,
    uniforms: {
      ...materialFogUniforms(fog),
      _Color: { value: linearColor(color) },
      _ColorPower: { value: surface.colorPower },
      _FresnelPower: { value: surface.fresnelPower },
      _Glow: { value: surface.glow },
      _LightDir: { value: surface.lightDirection.clone() },
      _HologramTexture: { value: hologram },
      _Time: { value: 0 },
    },
    transparent: !handle,
    depthWrite: handle,
    ...(handle
      ? {}
      : {
          blending: CustomBlending,
          blendEquation: AddEquation,
          blendSrc: OneFactor,
          blendDst: surface.kind === 'rim' ? OneFactor : OneMinusSrcAlphaFactor,
          blendEquationAlpha: AddEquation,
          blendSrcAlpha: OneFactor,
          blendDstAlpha: OneMinusSrcAlphaFactor,
        }),
  });
}

const TRAIL_FRAG = /* glsl */ `
uniform vec3 _Color;
uniform vec3 _FixedColor;
uniform sampler2D _TrailTexture;
varying float vTrailAlpha;
varying vec2 vTrailUv;
void main() {
  vec4 texel = texture2D(_TrailTexture, vTrailUv * vec2(0.5, 1.0));
  #ifdef SC_CUSTOM_COLORS
    vec3 color = _Color;
  #else
    vec3 color = _FixedColor;
  #endif
  float coverage = texel.r * vTrailAlpha;
  // Source Trail components multiply both hands by 231/255 and use _Glow=2.
  gl_FragColor = vec4(color * (231.0 / 255.0) * texel.rgb * 2.0 * vTrailAlpha, coverage);
  #include <colorspace_fragment>
}
`;

export function createScSaberTrailMaterial(customColors: boolean, side: 0 | 1, color: Rgb, texture: Texture) {
  return new ShaderMaterial({
    defines: customColors ? { SC_CUSTOM_COLORS: 1 } : {},
    vertexShader: SABER_TRAIL_VERT,
    fragmentShader: TRAIL_FRAG,
    uniforms: {
      _Color: { value: linearColor(color) },
      // Keep the non-CC variant fixed even when replay colors change at runtime.
      _FixedColor: {
        value: linearColor(side === 0 ? [212 / 255, 20 / 255, 90 / 255] : [231 / 255, 231 / 255, 231 / 255]),
      },
      _TrailTexture: { value: texture },
    },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendEquationAlpha: AddEquation,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
  });
}
