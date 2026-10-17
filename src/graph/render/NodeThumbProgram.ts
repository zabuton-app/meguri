// A file node drawn as its thumbnail: the node's disc, filled with the
// file's cell of the ThumbAtlas (already cropped square, so it covers the
// disc) instead of a colour. Built like sigma's NodeCircleProgram (one
// triangle around the disc, the same picking), so a node can switch between
// the two by its `type` alone.
//
// The picture sits inside a ring of the node's colour, so the kind still
// reads as it does for the dots (and the legend still holds). Faded nodes
// are mixed towards the background, as `fade()` does for the dots: a
// translucent picture would brighten rather than fade under sigma's
// premultiplied blending. The ring takes the faded colour from the reducer.
//
// sigma draws the hovered node again in a WebGL context of its own, so each
// program keeps its own texture, and copies into it the cells written since
// it last looked.
import type { Attributes } from "graphology-types";
import {
  NodeProgram,
  type NodeProgramType,
  type ProgramInfo,
} from "sigma/rendering";
import type { NodeDisplayData, RenderParams } from "sigma/types";
import { floatColor } from "sigma/utils";
import {
  ATLAS_WIDTH,
  CELL,
  CELLS,
  COLUMNS,
  cellOrigin,
  type ThumbAtlas,
} from "./thumbAtlas";

/** What the node reducer adds for a node drawn by this program. */
export interface ThumbDisplayData {
  /** The node's cell in the atlas. */
  thumbCell: number;
  /** 1, or FADED when the node is not next to the focused one. */
  thumbOpacity: number;
}

/** Share of a cell kept clear of its edge when sampling, so the smaller
 *  mipmap levels do not bleed the neighbouring cells in. */
const INSET = 2 / CELL;
/** The ring's width, as a share of the node's radius (never under 2 px). */
const RING = 0.18;

const VERTEX_SHADER = /* glsl */ `
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_position;
attribute float a_size;
attribute float a_cell;
attribute float a_opacity;
attribute float a_angle;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_correctionRatio;
uniform vec2 u_cellSize;

varying vec4 v_color;
varying vec2 v_diffVector;
varying float v_radius;
varying vec2 v_cellOrigin;
varying float v_opacity;

const float bias = 255.0 / 254.0;

void main() {
  float size = a_size * u_correctionRatio / u_sizeRatio * 4.0;
  vec2 diffVector = size * vec2(cos(a_angle), sin(a_angle));
  vec2 position = a_position + diffVector;
  gl_Position = vec4((u_matrix * vec3(position, 1)).xy, 0, 1);

  v_diffVector = diffVector;
  v_radius = size / 2.0;
  v_cellOrigin =
    vec2(mod(a_cell, ${COLUMNS.toFixed(1)}), floor(a_cell / ${COLUMNS.toFixed(1)})) *
    u_cellSize;
  v_opacity = a_opacity;

  #ifdef PICKING_MODE
  v_color = a_id;
  #else
  v_color = a_color;
  #endif

  v_color.a *= bias;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec4 v_color;
varying vec2 v_diffVector;
varying float v_radius;
varying vec2 v_cellOrigin;
varying float v_opacity;

uniform float u_correctionRatio;
uniform sampler2D u_atlas;
uniform vec2 u_cellSize;
uniform vec3 u_background;

const vec4 transparent = vec4(0.0, 0.0, 0.0, 0.0);
const float inset = ${INSET.toFixed(6)};
const float ringShare = ${RING.toFixed(6)};

void main(void) {
  float border = u_correctionRatio * 2.0;
  float dist = length(v_diffVector) - v_radius + border;

  #ifdef PICKING_MODE
  if (dist > border)
    gl_FragColor = transparent;
  else
    gl_FragColor = v_color;

  #else
  float ring = max(u_correctionRatio * 2.0, v_radius * ringShare);
  float inner = v_radius - ring;
  // Where in the cell: (0, 0) its top left. Graph y points up, rows down.
  // The whole picture fits inside the ring.
  vec2 p = v_diffVector / (2.0 * inner) * vec2(1.0, -1.0) + 0.5;
  p = clamp(p, inset, 1.0 - inset);
  vec4 texel = texture2D(u_atlas, v_cellOrigin + p * u_cellSize);
  // A picture with transparency (a logo, say) shows the background through
  // it rather than black: the texture's colours are not premultiplied.
  vec3 picture = mix(u_background, texel.rgb, texel.a);
  vec4 fill = vec4(mix(u_background, picture, v_opacity), 1.0);
  // Into the ring over about a pixel, so its inner edge is not jagged.
  float toRing = clamp(
    (length(v_diffVector) - inner) / u_correctionRatio + 0.5, 0.0, 1.0);
  vec4 color = mix(fill, vec4(v_color.rgb, 1.0), toRing);

  float t = 0.0;
  if (dist > border)
    t = 1.0;
  else if (dist > 0.0)
    t = dist / border;

  gl_FragColor = mix(color, transparent, t);
  #endif
}
`;

const UNIFORMS = [
  "u_sizeRatio",
  "u_correctionRatio",
  "u_matrix",
  "u_cellSize",
  "u_atlas",
  "u_background",
] as const;
type Uniform = (typeof UNIFORMS)[number];

const { UNSIGNED_BYTE, FLOAT } = WebGLRenderingContext;

/** A program class drawing from `atlas`, with `background` (0..1 RGB) the
 *  colour faded nodes are mixed towards. One per sigma instance: the atlas
 *  lives as long as it does. */
export function createNodeThumbProgram<
  N extends Attributes = Attributes,
  E extends Attributes = Attributes,
  G extends Attributes = Attributes,
>(
  atlas: ThumbAtlas,
  background: () => readonly [number, number, number],
): NodeProgramType<N, E, G> {
  return class NodeThumbProgram extends NodeProgram<Uniform, N, E, G> {
    static readonly ANGLE_1 = 0;
    static readonly ANGLE_2 = (2 * Math.PI) / 3;
    static readonly ANGLE_3 = (4 * Math.PI) / 3;

    private texture: WebGLTexture | null = null;
    /** The atlas height the texture was made for. */
    private textureHeight = 0;
    /** Per cell, the atlas write the texture holds. */
    private readonly uploaded = new Uint32Array(CELLS);

    getDefinition() {
      return {
        VERTICES: 3,
        VERTEX_SHADER_SOURCE: VERTEX_SHADER,
        FRAGMENT_SHADER_SOURCE: FRAGMENT_SHADER,
        METHOD: WebGLRenderingContext.TRIANGLES,
        UNIFORMS,
        ATTRIBUTES: [
          { name: "a_position", size: 2, type: FLOAT },
          { name: "a_size", size: 1, type: FLOAT },
          { name: "a_color", size: 4, type: UNSIGNED_BYTE, normalized: true },
          { name: "a_id", size: 4, type: UNSIGNED_BYTE, normalized: true },
          { name: "a_cell", size: 1, type: FLOAT },
          { name: "a_opacity", size: 1, type: FLOAT },
        ],
        CONSTANT_ATTRIBUTES: [{ name: "a_angle", size: 1, type: FLOAT }],
        CONSTANT_DATA: [
          [NodeThumbProgram.ANGLE_1],
          [NodeThumbProgram.ANGLE_2],
          [NodeThumbProgram.ANGLE_3],
        ],
      };
    }

    processVisibleItem(
      nodeIndex: number,
      startIndex: number,
      data: NodeDisplayData,
    ): void {
      const thumb = data as NodeDisplayData & Partial<ThumbDisplayData>;
      const array = this.array;
      array[startIndex++] = data.x;
      array[startIndex++] = data.y;
      array[startIndex++] = data.size;
      array[startIndex++] = floatColor(data.color);
      array[startIndex++] = nodeIndex;
      array[startIndex++] = thumb.thumbCell ?? 0;
      array[startIndex++] = thumb.thumbOpacity ?? 1;
    }

    setUniforms(
      params: RenderParams,
      { gl, uniformLocations }: ProgramInfo<Uniform>,
    ): void {
      gl.uniform1f(uniformLocations.u_correctionRatio, params.correctionRatio);
      gl.uniform1f(uniformLocations.u_sizeRatio, params.sizeRatio);
      gl.uniformMatrix3fv(uniformLocations.u_matrix, false, params.matrix);
      gl.uniform2f(
        uniformLocations.u_cellSize,
        CELL / ATLAS_WIDTH,
        CELL / Math.max(1, this.textureHeight),
      );
      gl.uniform1i(uniformLocations.u_atlas, 0);
      gl.uniform3fv(uniformLocations.u_background, background());
    }

    protected renderProgram(
      params: RenderParams,
      programInfo: ProgramInfo<Uniform>,
    ): void {
      // Picking only reads the ids; the picture is for the screen.
      if (!programInfo.isPicking) this.syncTexture(programInfo.gl);
      super.renderProgram(params, programInfo);
    }

    kill(): void {
      if (this.texture) this.normalProgram?.gl.deleteTexture(this.texture);
      this.texture = null;
      super.kill();
    }

    /** Brings the texture up to the atlas: made anew when the atlas grew,
     *  else only the cells written since. Left bound to unit 0. */
    private syncTexture(gl: ProgramInfo["gl"]): void {
      const height = atlas.canvas.height;
      gl.activeTexture(gl.TEXTURE0);
      if (!this.texture || this.textureHeight !== height) {
        this.texture ??= gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          ATLAS_WIDTH,
          height,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          null,
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(
          gl.TEXTURE_2D,
          gl.TEXTURE_MIN_FILTER,
          gl.LINEAR_MIPMAP_LINEAR,
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        this.textureHeight = height;
        this.uploaded.fill(0);
      } else {
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
      }
      let changed = false;
      for (let i = 0; i < CELLS; i++) {
        const written = atlas.written[i];
        if (written === this.uploaded[i]) continue;
        const pixels = atlas.cellPixels(i);
        if (!pixels) continue;
        const { x, y } = cellOrigin(i);
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          x,
          y,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixels,
        );
        this.uploaded[i] = written;
        changed = true;
      }
      // Both sides are powers of two, so WebGL 1 can mipmap the atlas.
      if (changed) gl.generateMipmap(gl.TEXTURE_2D);
    }
  };
}
