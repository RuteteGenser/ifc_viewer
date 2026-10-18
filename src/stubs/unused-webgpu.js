// Stand-in for "three/webgpu" and "three/tsl" in production builds.
//
// @thatopen/components imports them for a WebGPU compute path (GPU-assisted
// geometry overlap tests) that this viewer never calls. Bundling the real
// modules adds about 600 kB of JavaScript, which every first visit downloads
// and parses. If that path were ever reached it would fail loudly here.
function unavailable() {
  throw new Error("WebGPU support is not bundled in this build");
}

export const WebGPURenderer = unavailable;

export const instancedArray = unavailable;
export const Fn = unavailable;
export const instanceIndex = unavailable;
export const mat4 = unavailable;
export const Loop = unavailable;
export const int = unavailable;
export const vec3 = unavailable;
export const vec4 = unavailable;
export const float = unavailable;
export const cross = unavailable;
export const If = unavailable;
export const Continue = unavailable;
export const max = unavailable;
export const min = unavailable;
export const normalize = unavailable;
export const select = unavailable;
export const abs = unavailable;
export const mix = unavailable;
export const uint = unavailable;
export const atomicAdd = unavailable;
