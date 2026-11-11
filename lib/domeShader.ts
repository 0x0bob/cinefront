// The fisheye dome mapping, shared by the viewer. SAME formula and constants as the Unity player (quest/.../Dome/DomeMode.cs, BuildMesh + LateUpdate):
//   * equidistant model: a view direction at angle theta from the lens axis lands at radius rho = theta / (fov/2) * r around (cx, cy) in the video frame (image y points down)
//   * the dome is the cap theta <= (fov/2) * EDGE_FRACTION (DomeMode: thMax = halfFov * 0.998f); outside it the background colour (DomeMode camera background (0.01, 0.01, 0.015))
//   * the lens axis points UP from the real horizon by pitch_deg: d_dome = Rx(+tilt) d_level, so a level forward ray lands `tilt` BELOW the circle centre (DomeMode rotates the dome by Euler(-pitch, 0, 0))
//   * the feathered edge is baked into dome.mp4 (fisheye_dome.py fades the outer 5% of the radius to black), exactly as in the APK
// (TypeScript port of pipeline/scene_api/web/dome_shader.js: tests/domeShader.test.ts keeps the two identical)
// three.js looks down -z, the dome frame (and Unity) down +z: the shader flips z.
export type DomeProjection = { fov_deg: number; pitch_deg?: number; circle: { cx: number; cy: number; r: number; size: number } };
export const EDGE_FRACTION = 0.998;
export const BACKGROUND = [0.01, 0.01, 0.015];
export const SPHERE_RADIUS = 50;

export const DOME_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const DOME_FRAG = `
precision highp float;
uniform sampler2D map;
uniform vec4 circle;      // cx, cy, r, size   (pixels of the video frame)
uniform float halfFov;    // radians
uniform float tilt;       // radians (pitch_deg)
uniform float edge;
uniform vec3 bg;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 l = vec3(d.x, d.y, -d.z);                                   // level frame, +z forward
  float ct = cos(tilt), st = sin(tilt);
  vec3 dd = vec3(l.x, l.y * ct - l.z * st, l.y * st + l.z * ct);   // d_dome = Rx(+tilt) d_level
  float theta = acos(clamp(dd.z, -1.0, 1.0));
  if (theta > halfFov * edge) { gl_FragColor = vec4(bg, 1.0); return; }
  float rho = theta / halfFov * circle.z;
  float phi = atan(dd.y, dd.x);
  vec2 px = vec2(circle.x + rho * cos(phi), circle.y - rho * sin(phi));
  vec2 uv = vec2(px.x / circle.w, 1.0 - px.y / circle.w);
  gl_FragColor = vec4(texture2D(map, uv).rgb, 1.0);
}`;

export function domeUniforms(THREE: typeof import("three"), texture: import("three").Texture, proj: DomeProjection) {
  const c = proj.circle;
  return {
    map: { value: texture },
    circle: { value: new THREE.Vector4(c.cx, c.cy, c.r, c.size) },
    halfFov: { value: (proj.fov_deg / 2) * Math.PI / 180 },
    tilt: { value: (proj.pitch_deg || 0) * Math.PI / 180 },
    edge: { value: EDGE_FRACTION },
    bg: { value: new THREE.Vector3(...BACKGROUND) },
  };
}
