/**
 * Procedural surface looks for the skin and the tissues of the breast (docs/plano-pele-habito-vasos.md, phase G).
 *
 * The HRA skin has no texture coordinates, so the detail is computed in the shader from the REST position of every
 * point (the position attribute, before the morph targets, in mm): the pattern stays on the tissue in every breast
 * state and arm pose instead of sliding through it.
 *  - skin: light that wraps past the terminator with a reddish tint (a cheap stand-in for light scattered under the
 *    skin), low-frequency mottling, micro-relief (bump from noise, faded when a pixel covers more than its scale, so it
 *    never shimmers), a darker rim at the cut borders of the trunk and, in gigantomastia, dilated superficial veins;
 *  - skin on phones: wrap, mottling, rim and veins (no micro-relief);
 *  - fat: lobules (cellular noise) with paler septa; gland: fine mottling.
 */
import * as THREE from "three";

export type SurfaceLook = "skin" | "skin-lite" | "areola" | "fat" | "gland";

/**
 * Shared by every skin material: the dilated veins of gigantomastia fade in with the breast level (HybridModel); the
 * saturation of the skin is set by the tone mapping of the viewer (the neutral one shows the base colour as it is).
 */
export const skinUniforms = {
  uVeins: { value: 0 },
  uSkinSaturation: { value: 1 },
};

// 3D simplex noise: Ian McEwan, Ashima Arts / Stefan Gustavson (MIT license, https://github.com/ashima/webgl-noise)
const SIMPLEX = /* glsl */ `
vec3 sk_mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 sk_mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 sk_permute(vec4 x) { return sk_mod289(((x * 34.0) + 10.0) * x); }
vec4 sk_taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float sk_snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = sk_mod289(i);
  vec4 p = sk_permute(sk_permute(sk_permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = sk_taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
// distance to the nearest and second nearest feature point of a jittered grid (cellular noise)
vec2 sk_cells(vec3 p) {
  vec3 cell = floor(p);
  vec3 f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 o = vec3(float(x), float(y), float(z));
    vec3 h = fract(sin(vec3(dot(cell + o, vec3(127.1, 311.7, 74.7)), dot(cell + o, vec3(269.5, 183.3, 246.1)), dot(cell + o, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
    float d = length(o + h - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return vec2(d1, d2);
}
vec3 sk_bump(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDirection) {
  vec3 sigmaX = normalize(dFdx(surfPos));
  vec3 sigmaY = normalize(dFdy(surfPos));
  vec3 r1 = cross(sigmaY, surfNorm);
  vec3 r2 = cross(surfNorm, sigmaX);
  float det = dot(sigmaX, r1) * faceDirection;
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surfNorm - grad);
}
`;

const SKIN_TINT = /* glsl */ `
diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722))), diffuseColor.rgb, uSkinSaturation);
// mottling: a few percent of luminance, slightly warmer patches
float sk_m = 0.6 * sk_snoise(vRestMm / 35.0) + 0.4 * sk_snoise(vRestMm / 11.0 + 3.1);
diffuseColor.rgb *= 1.0 + 0.04 * sk_m;
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.04, 0.96, 0.95), 0.5 + 0.5 * sk_snoise(vRestMm / 55.0 + 7.0));
#ifdef SK_VEINS
  // dilated superficial veins of gigantomastia, over the breasts (rest positions) only
  float sk_near = max(1.0 - smoothstep(70.0, 125.0, distance(vRestMm, uBreastA)), 1.0 - smoothstep(70.0, 125.0, distance(vRestMm, uBreastB)));
  // a few long, soft, bluish lines: the zero set of a low-frequency noise, wobbling a little
  float sk_line = abs(sk_snoise(vRestMm / 42.0) + 0.25 * sk_snoise(vRestMm / 14.0 + 11.0));
  float sk_vein = (1.0 - smoothstep(0.02, 0.09, sk_line)) * sk_near * uVeins;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.84, 0.88, 1.0), 0.5 * sk_vein);
#endif
// the cut borders of the trunk: a slice of skin, a little darker
diffuseColor.rgb *= 1.0 - 0.25 * vRim;
`;

/** Vertex declarations: the rest position in model mm (attribute restMm, see restAttributes) and the rim weight. */
function vertexPart(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nattribute vec3 restMm;\nvarying vec3 vRestMm;\nattribute float rim;\nvarying float vRim;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRestMm = restMm;\nvRim = rim;");
}

/**
 * Per-vertex attributes the looks read: `restMm`, the rest position in model mm (the pattern stays on the tissue
 * whatever the morph targets, the view rotation or a manipulation do), and, for the trunk skin, `rim`, 1 on the cut
 * borders. `toModel`: mesh-local to model space; `unitsPerMm`: model units per mm. Kept when already there.
 */
export function restAttributes(geometry: THREE.BufferGeometry, toModel: THREE.Matrix4, unitsPerMm: number, withRim: boolean) {
  const position = geometry.attributes.position;
  if (!geometry.attributes.restMm) {
    const out = new Float32Array(position.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) v.fromBufferAttribute(position, i).applyMatrix4(toModel).divideScalar(unitsPerMm).toArray(out, i * 3);
    geometry.setAttribute("restMm", new THREE.BufferAttribute(out, 3));
  }
  if (withRim && !geometry.attributes.rim && geometry.index) {
    // vertices of the edges with one triangle: the inner edge of the rim strip of the cut skin
    const index = geometry.index.array;
    const count = position.count;
    const edges = new Map<number, number>();
    for (let f = 0; f < index.length; f += 3) {
      for (let k = 0; k < 3; k++) {
        const a = index[f + k], b = index[f + ((k + 1) % 3)];
        const key = a < b ? a * count + b : b * count + a;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    const rim = new Float32Array(count);
    edges.forEach((n, key) => {
      if (n !== 1) return;
      rim[Math.floor(key / count)] = 1;
      rim[key % count] = 1;
    });
    geometry.setAttribute("rim", new THREE.BufferAttribute(rim, 1));
  }
}

/**
 * Gives a material one of the procedural looks. `worldPerMm`: world units per mm of the model (the height of the
 * micro-relief); `breasts`: rest centres of both breasts (model units) for the veins.
 */
export function applySurfaceLook(material: THREE.MeshStandardMaterial, look: SurfaceLook, worldPerMm: number, breasts?: [THREE.Vector3, THREE.Vector3]) {
  const skin = look === "skin" || look === "skin-lite";
  const veins = skin && Boolean(breasts);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWorldPerMm = { value: worldPerMm };
    shader.uniforms.uSkinSaturation = skinUniforms.uSkinSaturation;
    vertexPart(shader);
    let fragment = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>\nuniform float uWorldPerMm;\nuniform float uSkinSaturation;\nvarying vec3 vRestMm;\nvarying float vRim;\n${veins ? "#define SK_VEINS\nuniform float uVeins;\nuniform vec3 uBreastA;\nuniform vec3 uBreastB;\n" : ""}${SIMPLEX}`,
    );
    if (veins && breasts) {
      shader.uniforms.uVeins = skinUniforms.uVeins;
      shader.uniforms.uBreastA = { value: breasts[0].clone().divideScalar(worldPerMm) };
      shader.uniforms.uBreastB = { value: breasts[1].clone().divideScalar(worldPerMm) };
    }
    if (skin) {
      fragment = fragment.replace("#include <color_fragment>", `#include <color_fragment>\n${SKIN_TINT}`);
      // light wraps past the terminator, reddish there (scattering under the skin)
      shader.fragmentShader = fragment;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <lights_physical_pars_fragment>",
        THREE.ShaderChunk.lights_physical_pars_fragment.replace(
          "reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );",
          `float skWrap = saturate( ( dot( geometryNormal, directLight.direction ) + 0.3 ) / 1.3 );
	vec3 skScatter = mix( vec3( 1.0, 0.62, 0.52 ), vec3( 1.0 ), smoothstep( 0.0, 0.45, skWrap ) );
	reflectedLight.directDiffuse += skWrap * directLight.color * skScatter * BRDF_Lambert( material.diffuseColor );`,
        ),
      );
      fragment = shader.fragmentShader;
    }
    if (look === "skin" || look === "areola") {
      // micro-relief: two octaves of noise as a height (mm), each faded out where a pixel covers more than half its scale
      const [scale1, amp1, scale2, amp2] = look === "skin" ? [2.4, 0.08, 0.85, 0.022] : [1.1, 0.05, 0.45, 0.015];
      fragment = fragment.replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
{
  float skPixel = length(fwidth(vRestMm));
  float skH = ${amp1.toFixed(3)} * sk_snoise(vRestMm / ${scale1.toFixed(2)}) * (1.0 - smoothstep(${(scale1 * 0.25).toFixed(3)}, ${(scale1 * 0.5).toFixed(3)}, skPixel))
            + ${amp2.toFixed(3)} * sk_snoise(vRestMm / ${scale2.toFixed(2)} + 5.0) * (1.0 - smoothstep(${(scale2 * 0.25).toFixed(3)}, ${(scale2 * 0.5).toFixed(3)}, skPixel));
  skH *= uWorldPerMm;
  normal = sk_bump(-vViewPosition, normal, vec2(dFdx(skH), dFdy(skH)), faceDirection);
}`,
      );
      // a little variation of the roughness too
      fragment = fragment.replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * (1.0 + 0.08 * sk_snoise(vRestMm / 18.0 + 2.0)), 0.04, 1.0);");
    }
    if (look === "fat") {
      fragment = fragment.replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  vec2 skC = sk_cells(vRestMm / 7.0);
  float skSeptum = 1.0 - smoothstep(0.02, 0.1, skC.y - skC.x);
  diffuseColor.rgb = mix(diffuseColor.rgb * (0.95 + 0.1 * sk_snoise(vRestMm / 7.0)), mix(diffuseColor.rgb, vec3(1.0, 0.96, 0.86), 0.55), skSeptum);
}`,
      );
    }
    if (look === "gland") {
      fragment = fragment.replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= 1.0 + 0.06 * sk_snoise(vRestMm / 3.0) + 0.04 * sk_snoise(vRestMm / 9.0 + 4.0);");
    }
    shader.fragmentShader = fragment;
  };
  material.customProgramCacheKey = () => `surface-${look}${veins ? "-veins" : ""}`;
  return material;
}

/**
 * Filled cut faces for the section tool: where a clipping plane opens a closed mesh, its inner (back) faces are drawn in
 * the flat colour of the tissue (with its pattern), so the cut reads as a solid slice of it instead of a hollow shell.
 * Chains the shader changes the material already has.
 */
export function applyCaps(material: THREE.MeshStandardMaterial) {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", "#include <opaque_fragment>\nif (!gl_FrontFacing) gl_FragColor.rgb = diffuseColor.rgb * 0.9;");
  };
  material.customProgramCacheKey = () => `${previousKey.call(material)}-cap`;
  return material;
}
