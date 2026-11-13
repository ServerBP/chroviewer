import {
  AddEquation,
  CustomBlending,
  DoubleSide,
  OneFactor,
  ShaderMaterial,
  SrcAlphaFactor,
  Vector3,
  ZeroFactor,
  type Texture,
} from 'three';

import type { Rgb } from '../../core/colors';
import type { FogUniforms } from '../bloomfog/pipeline';
import { linearColor, materialFogUniforms } from '../materials/shared';
import { ACES_CHUNK, FOG_CHUNK, OBJECT_VERT } from '../shaders/chunks';
import { SABER_TRAIL_VERT } from '../shaders/map-object-shaders';

// The source Unlit Glow stores bloom in alpha. It has no white core or animation;
// _Color2, _Speed, _Freq and _Bloom are stale material properties, not shader inputs.
const GLOW_FRAG = /* glsl */ `
uniform vec3 _Color;
uniform float _Glow;
uniform float _FogStartOffset;
uniform float _FogScale;
varying vec3 vWorldPos;
varying vec4 vScreenPos;
${FOG_CHUNK}
void main() {
  gl_FragColor = applyChroFog(vec4(_Color, _Glow), vScreenPos, vWorldPos, _FogStartOffset, _FogScale);
  #include <colorspace_fragment>
}
`;

// The bundle's BeatSaber/Standard material uses a view-dependent rim and a
// blurred screen grab. ChroViewer's environment prepass supplies the lighting
// capture without a per-saber GrabPass (including in multiview and mirrors).
const FRESNEL_FRAG = /* glsl */ `
uniform vec3 _Color;
uniform float _Scale;
uniform float _Power;
uniform float _Ambient;
uniform float _Smoothness;
uniform float _LightIntensity;
uniform vec3 _LightDir;
uniform float _FogStartOffset;
uniform float _FogScale;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vViewNormal;
varying vec4 vScreenPos;
${ACES_CHUNK}
${FOG_CHUNK}
vec3 capture(vec2 uv) {
  return texture2D(_BloomPrePassTexture, clamp(uv, 0.0, 1.0)).rgb;
}
void main() {
  vec3 normal = normalize(vWorldNormal);
  vec3 view = normalize(cameraPosition - vWorldPos);
  vec3 lightDir = normalize(-_LightDir);
  vec3 halfDir = normalize(view + lightDir);
  float facing = clamp(dot(normal, view), 0.0, 1.0);
  float ndotl = max(dot(normal, lightDir), 0.0);
  float ndoth = max(dot(normal, halfDir), 0.0);
  float ldoth = max(dot(lightDir, halfDir), 0.0);
  float roughness = (1.0 - _Smoothness) * (1.0 - _Smoothness);
  float a2 = roughness * roughness;
  float denom = ndoth * ndoth * (a2 - 1.0) + 1.0;
  float distribution = a2 / max(3.14159265 * denom * denom, 0.00001);
  float k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
  float geometry = facing / max(facing * (1.0 - k) + k, 0.00001)
    * ndotl / max(ndotl * (1.0 - k) + k, 0.00001);
  float specularFresnel = 0.04 + 0.96 * pow(1.0 - ldoth, 5.0);
  float specular = distribution * geometry * specularFresnel / max(4.0 * facing * ndotl, 0.00001);
  vec3 lighting = vec3(0.0);
  for (int y = 1; y <= 3; ++y) {
    for (int x = 1; x <= 3; ++x) {
      lighting += capture(vec2(float(x), float(y)) * 0.25) / 9.0;
    }
  }
  vec2 screenUv = (vScreenPos.xy / vScreenPos.w - 0.5) * _CustomFogTextureToScreenRatio + 0.5;
  // Unity's 50-pixel reflection offset, expressed against the current capture.
  vec2 texel = 1.0 / vec2(textureSize(_BloomPrePassTexture, 0));
  vec2 offset = normalize(vViewNormal).xy * 50.0 * texel;
  vec2 blur = 50.0 * (1.0 - _Smoothness) * texel;
  vec3 reflection = capture(screenUv + offset + vec2(-blur.x, -blur.y)) * 0.11
    + capture(screenUv + offset + vec2(-blur.x, 0.0)) * 0.10
    + capture(screenUv + offset + vec2(-blur.x, blur.y)) * 0.05
    + capture(screenUv + offset + vec2(0.0, -blur.y)) * 0.15
    + capture(screenUv + offset) * 0.18
    + capture(screenUv + offset + vec2(0.0, blur.y)) * 0.15
    + capture(screenUv + offset + vec2(blur.x, -blur.y)) * 0.05
    + capture(screenUv + offset + vec2(blur.x, 0.0)) * 0.10
    + capture(screenUv + offset + vec2(blur.x, blur.y)) * 0.11;
  float rim = _Scale * pow(1.0 - facing, _Power);
  vec3 surface = (_Color * 0.96 * (ndotl + _Ambient) + vec3(specular * ndotl))
    * lighting * _LightIntensity + rim * reflection;
  gl_FragColor = applyChroFog(vec4(chroToneMap(surface), 0.0), vScreenPos, vWorldPos, _FogStartOffset, _FogScale);
  #include <colorspace_fragment>
}
`;

// Legacy Shaders/Particles/Additive: 2 * vertexColor * _TintColor * texture,
// blended SrcAlpha/One with ColorMask RGB. The source tint alpha is 80/255.
const TRAIL_FRAG = /* glsl */ `
uniform vec3 _Color;
uniform sampler2D _TrailTexture;
uniform float _TintAlpha;
varying float vTrailAlpha;
varying vec2 vTrailUv;
void main() {
  vec4 texel = texture2D(_TrailTexture, vTrailUv);
  gl_FragColor = vec4(2.0 * _Color * texel.rgb, 2.0 * _TintAlpha * texel.a * vTrailAlpha);
  #include <colorspace_fragment>
}
`;

export function createSpiderSaberGlowMaterial(fog: FogUniforms, color: Rgb) {
  return new ShaderMaterial({
    vertexShader: OBJECT_VERT,
    fragmentShader: GLOW_FRAG,
    uniforms: {
      ...materialFogUniforms(fog),
      _Color: { value: linearColor(color) },
      _Glow: { value: 0.75 },
    },
  });
}

export function createSpiderSaberFresnelMaterial(fog: FogUniforms, color: Rgb) {
  return new ShaderMaterial({
    vertexShader: OBJECT_VERT,
    fragmentShader: FRESNEL_FRAG,
    uniforms: {
      ...materialFogUniforms(fog),
      _Color: { value: linearColor(color) },
      _Scale: { value: 5 },
      _Power: { value: 1.2899999618530273 },
      _Ambient: { value: 0.07500000298023224 },
      _Smoothness: { value: 0.17499999701976776 },
      _LightIntensity: { value: 1 },
      _LightDir: { value: new Vector3(0, -1, 2) },
    },
  });
}

export function createSpiderSaberTrailMaterial(color: Rgb, texture: Texture) {
  return new ShaderMaterial({
    vertexShader: SABER_TRAIL_VERT,
    fragmentShader: TRAIL_FRAG,
    uniforms: {
      _Color: { value: linearColor(color) },
      _TrailTexture: { value: texture },
      _TintAlpha: { value: 0.3137255012989044 },
    },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: SrcAlphaFactor,
    blendDst: OneFactor,
    blendEquationAlpha: AddEquation,
    // Preserve scene alpha, matching the native trail’s RGB-only color mask.
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
  });
}
