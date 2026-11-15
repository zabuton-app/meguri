import {
  exposureKnee,
  exposureShoulder,
  gradeKeys,
  type VideoGrade,
} from "./colorGrade";

const vertexSource = `#version 300 es
out vec2 uv;
void main() {
  uv = vec2(float(gl_VertexID % 2), float(gl_VertexID / 2));
  gl_Position = vec4(uv * 2.0 - 1.0, 0, 1);
}`;

const fragmentSource = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 pixel;
uniform sampler2D frame;
uniform float exposure, shoulder, contrast, pivot, saturation, temperature, tint;
const vec3 luma = vec3(0.2126, 0.7152, 0.0722);

vec3 linearize(vec3 v) {
  return mix(v / 12.92, pow((v + 0.055) / 1.055, vec3(2.4)), step(0.04045, v));
}
vec3 encode(vec3 v) {
  return mix(v * 12.92, 1.055 * pow(v, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, v));
}
float filmic(float light) {
  if (light <= 0.0 || light >= 1.0 || contrast == 1.0) return light;
  float origin = log(pivot / (1.0 - pivot));
  float value = log(light / (1.0 - light));
  return 1.0 / (1.0 + exp(-(origin + contrast * (value - origin))));
}
void main() {
  vec3 rgb = linearize(texture(frame, vec2(uv.x, 1.0 - uv.y)).rgb);
  // Warm/cool and green/magenta are relative corrections on decoded video.
  vec3 gains = exp2(vec3(temperature + tint * 0.4, -tint, -temperature + tint * 0.4) / 150.0);
  rgb *= gains * (exp2(exposure) / dot(gains, luma));
  float y = dot(rgb, luma);
  if (y <= 0.000001) {
    pixel = vec4(0, 0, 0, 1);
    return;
  }
  // Subtractive saturation scales log channel ratios around the strongest
  // channel. Increasing it deepens weaker channels, keeping the strongest
  // there instead of adding RGB energy. Below unity, blend toward a gray
  // matched to the input luma.
  float peak = max(max(rgb.r, rgb.g), rgb.b);
  if (saturation < 1.0) rgb = mix(vec3(y), rgb, saturation);
  else if (saturation > 1.0)
    rgb = peak * pow(clamp(rgb / peak, 0.0, 1.0), vec3(saturation));
  y = dot(rgb, luma);
  // Preserve the exposure gain below the knee, then smoothly fit the new
  // white level into range. Contrast has its own toe and shoulder.
  float overKnee = max(0.0, y - ${exposureKnee});
  float exposed = min(y, ${exposureKnee}) + overKnee / (1.0 + shoulder * overKnee);
  float mapped = clamp(filmic(exposed), 0.0, 1.0);
  rgb *= mapped / y;

  // Fit highlights to the display gamut at constant luma and channel direction.
  peak = max(max(rgb.r, rgb.g), rgb.b);
  if (peak > 1.0)
    rgb = mix(vec3(mapped), rgb, (1.0 - mapped) / (peak - mapped));
  pixel = vec4(encode(clamp(rgb, 0.0, 1.0)), 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Shader creation failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(error || "Shader compilation failed");
  }
  return shader;
}

export function createGradeRenderer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    depth: false,
    antialias: false,
    powerPreference: "low-power",
    preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error("WebGL2 unavailable");
  const program = gl.createProgram();
  const texture = gl.createTexture();
  let vertex: WebGLShader | undefined;
  let fragment: WebGLShader | undefined;
  function dispose() {
    gl?.deleteTexture(texture);
    gl?.deleteProgram(program);
    if (vertex) gl?.deleteShader(vertex);
    if (fragment) gl?.deleteShader(fragment);
  }
  try {
    if (!program || !texture) throw new Error("WebGL resources unavailable");
    vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
    fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error("Could not link color shader");

    gl.useProgram(program);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // The browser converts the decoded video's tagged display color into sRGB.
    // Decode that transfer to linear light in the shader exactly once.
    gl.unpackColorSpace = "srgb";
    gl.drawingBufferColorSpace = "srgb";
    const uniforms = gradeKeys.map((key) =>
      gl.getUniformLocation(program, key),
    );
    const shoulder = gl.getUniformLocation(program, "shoulder");
    const maxSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
    return {
      draw(video: HTMLVideoElement, grade: VideoGrade): void {
        const dpr = window.devicePixelRatio || 1;
        const scale = Math.min(
          1,
          (canvas.clientWidth * dpr) / video.videoWidth,
          (canvas.clientHeight * dpr) / video.videoHeight,
        );
        if (scale <= 0) return;
        if (video.videoWidth > maxSize || video.videoHeight > maxSize)
          throw new Error("Video exceeds GPU texture size");
        const width = Math.max(1, Math.round(video.videoWidth * scale));
        const height = Math.max(1, Math.round(video.videoHeight * scale));
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        gl.viewport(0, 0, width, height);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          video,
        );
        for (const [index, key] of gradeKeys.entries())
          gl.uniform1f(uniforms[index], grade[key]);
        gl.uniform1f(shoulder, exposureShoulder(2 ** grade.exposure));
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        if (gl.getError() !== gl.NO_ERROR)
          throw new Error("Color preview draw failed");
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
