import type { PrimitiveKind } from '../types';

const VS_COMMON = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 u_res;      // canvas size in CSS px
uniform vec4 u_t;        // sx, sy, ox, oy
uniform float u_dpr;
uniform float u_snap;
vec2 toPx(vec2 p) { return p * u_t.xy + u_t.zw; }
vec4 toClip(vec2 px) { vec2 c = px / u_res * 2.0 - 1.0; return vec4(c.x, -c.y, 0.0, 1.0); }
vec2 corner() { return vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)); }
`;

const FS_COMMON = /* glsl */ `#version 300 es
precision highp float;
uniform float u_dpr;
uniform float u_opacity;
out vec4 outColor;
vec4 premul(vec4 c) { return vec4(c.rgb * c.a, c.a); }
`;

const RECT_VS = VS_COMMON + /* glsl */ `
layout(location=0) in vec4 a_rect;
layout(location=1) in vec4 a_fill;
layout(location=2) in vec4 a_stroke;
layout(location=3) in vec4 a_radii;
layout(location=4) in vec4 a_params;
layout(location=5) in float a_axis;
out vec2 v_p;
flat out vec2 v_half;
flat out vec4 v_fill;
flat out vec4 v_stroke;
flat out vec4 v_radii;
flat out float v_sw;
void main() {
  vec2 a = toPx(a_rect.xy), b = toPx(a_rect.zw);
  vec2 mn = min(a, b), mx = max(a, b);
  // Work in the frame of a vertical bar (thickness along x, data growing up),
  // then swap back for horizontal bars.
  bool horiz = a_axis > 0.5;
  if (horiz) { mn = mn.yx; mx = mx.yx; }
  float stackGap = horiz ? -a_params.z : a_params.z;
  float mw = a_params.w;
  if (mw > 0.0 && mx.x - mn.x > mw) {
    float c = (mn.x + mx.x) * 0.5;
    mn.x = c - mw * 0.5; mx.x = c + mw * 0.5;
  }
  vec2 size = mx - mn;
  float gx = min(a_params.y, max(size.x - 1.0, 0.0)) * 0.5;
  mn.x += gx; mx.x -= gx;
  float gy = min(abs(stackGap), max(size.y - 1.0, 0.0));
  if (stackGap > 0.0) mn.y += gy; else if (stackGap < 0.0) mx.y -= gy;
  if (horiz) { mn = mn.yx; mx = mx.yx; }
  size = mx - mn;
  if (u_snap > 0.5) {
    vec2 smn = round(mn * u_dpr) / u_dpr, smx = round(mx * u_dpr) / u_dpr;
    if (size.x > 0.0) smx.x = max(smx.x, smn.x + 1.0 / u_dpr);
    if (size.y > 0.0) smx.y = max(smx.y, smn.y + 1.0 / u_dpr);
    mn = smn; mx = smx;
  }
  vec2 half_ = (mx - mn) * 0.5;
  vec2 center = (mn + mx) * 0.5;
  vec2 pos = mix(mn - 1.0, mx + 1.0, corner());
  v_p = pos - center;
  v_half = half_;
  v_fill = a_fill; v_stroke = a_stroke;
  v_radii = min(a_radii, vec4(min(half_.x, half_.y)));
  v_sw = a_params.x;
  gl_Position = toClip(pos);
}`;

const RECT_FS = FS_COMMON + /* glsl */ `
in vec2 v_p;
flat in vec2 v_half;
flat in vec4 v_fill;
flat in vec4 v_stroke;
flat in vec4 v_radii;
flat in float v_sw;
float sdRoundBox(vec2 p, vec2 b, vec4 r) {
  float rr = p.x > 0.0 ? (p.y > 0.0 ? r.z : r.y) : (p.y > 0.0 ? r.w : r.x);
  vec2 q = abs(p) - b + rr;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - rr;
}
void main() {
  float d = sdRoundBox(v_p, v_half, v_radii);
  float a = clamp(0.5 - d * u_dpr, 0.0, 1.0);
  vec4 col = premul(v_fill);
  if (v_sw > 0.0) {
    float s = clamp(0.5 + (d + v_sw) * u_dpr, 0.0, 1.0);
    col = mix(col, premul(v_stroke), s);
  }
  outColor = col * a * u_opacity;
}`;

const POINT_VS = VS_COMMON + /* glsl */ `
layout(location=0) in vec4 a_point;
layout(location=1) in vec4 a_fill;
layout(location=2) in vec4 a_stroke;
layout(location=3) in float a_sw;
out vec2 v_p;
flat out float v_r;
flat out float v_shape;
flat out vec4 v_fill;
flat out vec4 v_stroke;
flat out float v_sw;
void main() {
  vec2 center = toPx(a_point.xy);
  float r = a_point.z * 0.5;
  float ext = r + a_sw + 1.0;
  vec2 off = (corner() * 2.0 - 1.0) * ext;
  v_p = off; v_r = r; v_shape = a_point.w;
  v_fill = a_fill; v_stroke = a_stroke; v_sw = a_sw;
  gl_Position = toClip(center + off);
}`;

const POINT_FS = FS_COMMON + /* glsl */ `
in vec2 v_p;
flat in float v_r;
flat in float v_shape;
flat in vec4 v_fill;
flat in vec4 v_stroke;
flat in float v_sw;
float sdTri(vec2 p, float r) {
  const float k = 1.7320508;
  p.y = -p.y;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}
void main() {
  float d;
  if (v_shape < 0.5) d = length(v_p) - v_r;
  else if (v_shape < 1.5) { vec2 q = abs(v_p); d = max(q.x, q.y) - v_r * 0.886; }
  else if (v_shape < 2.5) { vec2 q = abs(v_p); d = (q.x + q.y) * 0.7071 - v_r * 0.8; }
  else d = sdTri(v_p, v_r * 0.95);
  float a = clamp(0.5 - (d - v_sw) * u_dpr, 0.0, 1.0);
  vec4 col = premul(v_fill);
  if (v_sw > 0.0) {
    float s = clamp(0.5 + d * u_dpr, 0.0, 1.0);
    col = mix(col, premul(v_stroke), s);
  }
  outColor = col * a * u_opacity;
}`;

const LINE_VS = VS_COMMON + /* glsl */ `
layout(location=0) in vec4 a_seg;
layout(location=1) in vec4 a_color;
layout(location=2) in float a_width;
out vec2 v_p;
flat out vec2 v_a;
flat out vec2 v_b;
flat out vec4 v_color;
flat out float v_hw;
vec2 snap(vec2 p, float w) {
  float wd = max(round(w * u_dpr), 1.0);
  bool odd = mod(wd, 2.0) > 0.5;
  return odd ? (floor(p * u_dpr) + 0.5) / u_dpr : round(p * u_dpr) / u_dpr;
}
void main() {
  vec2 a = toPx(a_seg.xy), b = toPx(a_seg.zw);
  float w = a_width;
  if (u_snap > 0.5) { a = snap(a, w); b = snap(b, w); w = max(round(w * u_dpr), 1.0) / u_dpr; }
  vec2 dir = b - a;
  float len = length(dir);
  vec2 d = len > 1e-6 ? dir / len : vec2(1.0, 0.0);
  vec2 n = vec2(-d.y, d.x);
  float hw = w * 0.5;
  float ext = hw + 1.0;
  vec2 c = corner();
  vec2 pos = a + d * mix(-ext, len + ext, c.x) + n * (c.y * 2.0 - 1.0) * ext;
  v_p = pos; v_a = a; v_b = b; v_color = a_color; v_hw = hw;
  gl_Position = toClip(pos);
}`;

const LINE_FS = FS_COMMON + /* glsl */ `
in vec2 v_p;
flat in vec2 v_a;
flat in vec2 v_b;
flat in vec4 v_color;
flat in float v_hw;
void main() {
  vec2 pa = v_p - v_a, ba = v_b - v_a;
  float l2 = dot(ba, ba);
  float h = l2 > 0.0 ? clamp(dot(pa, ba) / l2, 0.0, 1.0) : 0.0;
  float dist = length(pa - ba * h);
  float a = clamp(0.5 + (v_hw - dist) * u_dpr, 0.0, 1.0);
  outColor = premul(v_color) * a * u_opacity;
}`;

const MESH_VS = VS_COMMON + /* glsl */ `
layout(location=0) in vec2 a_pos;
layout(location=1) in vec4 a_color;
out vec4 v_color;
void main() {
  v_color = a_color;
  gl_Position = toClip(toPx(a_pos));
}`;

const MESH_FS = FS_COMMON + /* glsl */ `
in vec4 v_color;
void main() { outColor = premul(v_color) * u_opacity; }`;

const ARC_VS = VS_COMMON + /* glsl */ `
layout(location=0) in vec4 a_arc;
layout(location=1) in vec4 a_angles;
layout(location=2) in vec4 a_fill;
out vec2 v_p;
flat out vec4 v_geo;   // r0, r1 (px), a0, a1
flat out float v_gap;
flat out vec4 v_fill;
void main() {
  vec2 center = toPx(a_arc.xy);
  float scale = abs(u_t.x);
  float r1 = a_arc.w * scale;
  float ext = r1 + 2.0;
  vec2 off = (corner() * 2.0 - 1.0) * ext;
  v_p = off;
  v_geo = vec4(a_arc.z * scale, r1, a_angles.x, a_angles.y);
  v_gap = a_angles.z;
  v_fill = a_fill;
  gl_Position = toClip(center + off);
}`;

const ARC_FS = FS_COMMON + /* glsl */ `
in vec2 v_p;
flat in vec4 v_geo;
flat in float v_gap;
flat in vec4 v_fill;
const float TAU = 6.28318530718;
void main() {
  float d = length(v_p);
  float sweep = v_geo.w - v_geo.z;
  if (sweep <= 0.0 || v_geo.y <= v_geo.x) discard;
  float halfGap = v_gap * 0.5;
  // Radial edges; a ring that starts at the center has no inner edge.
  float sdRad = v_geo.y - halfGap - d;
  if (v_geo.x > 0.0) sdRad = min(sdRad, d - v_geo.x - halfGap);
  float sd = sdRad;
  if (sweep < TAU - 1e-4) {
    // Clockwise angle from 12 o'clock (screen y points down).
    float ang = atan(v_p.x, -v_p.y);
    float rel = mod(ang - v_geo.z, TAU);
    // Distances along the arc, in px, to the two angular edges.
    float sdAng = rel <= sweep ? min(rel, sweep - rel) * d : -min(rel - sweep, TAU - rel) * d;
    sd = min(sd, sdAng - halfGap);
  }
  float a = clamp(0.5 + sd * u_dpr, 0.0, 1.0);
  if (a <= 0.0) discard;
  outColor = premul(v_fill) * a * u_opacity;
}`;

export const SHADERS: Record<PrimitiveKind, { vs: string; fs: string }> = {
  arc: { vs: ARC_VS, fs: ARC_FS },
  rect: { vs: RECT_VS, fs: RECT_FS },
  point: { vs: POINT_VS, fs: POINT_FS },
  line: { vs: LINE_VS, fs: LINE_FS },
  mesh: { vs: MESH_VS, fs: MESH_FS },
};
