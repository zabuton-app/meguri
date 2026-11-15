export const gradeControls = {
  exposure: { min: -4, max: 4, step: 0.05, neutral: 0 },
  contrast: { min: 0.5, max: 2, step: 0.01, neutral: 1 },
  pivot: { min: 0.04, max: 0.6, step: 0.01, neutral: 0.18 },
  saturation: { min: 0, max: 2, step: 0.01, neutral: 1 },
  temperature: { min: -100, max: 100, step: 1, neutral: 0 },
  tint: { min: -100, max: 100, step: 1, neutral: 0 },
} as const;

export type GradeControl = keyof typeof gradeControls;
export type VideoGrade = Record<GradeControl, number>;

export const gradeKeys = Object.keys(gradeControls) as GradeControl[];
export const neutralGrade: VideoGrade = {
  exposure: 0,
  contrast: 1,
  pivot: 0.18,
  saturation: 1,
  temperature: 0,
  tint: 0,
};

export function gradeChangesPicture(grade: VideoGrade): boolean {
  return gradeKeys.some(
    (key) => key !== "pivot" && grade[key] !== neutralGrade[key],
  );
}

export const exposureKnee = 0.5;

/** Keep tagged HDR sources out of the SDR canvas, including native PQ and HLG. */
export function hasHdrTransfer(metadata: unknown): boolean {
  const streams = (metadata as { streams?: unknown } | null)?.streams;
  if (!Array.isArray(streams)) return false;
  const primary = (
    streams as ({
      codec_type?: string;
      color_transfer?: string;
      disposition?: { attached_pic?: number };
    } | null)[]
  ).find(
    (stream) =>
      stream?.codec_type === "video" && stream.disposition?.attached_pic !== 1,
  );
  return (
    primary?.color_transfer === "smpte2084" ||
    primary?.color_transfer === "arib-std-b67"
  );
}

export function exposureShoulder(gain: number): number {
  return gain > 1 ? 1 / (1 - exposureKnee) - 1 / (gain - exposureKnee) : 0;
}

// In log-odds space the pivot is fixed and the multiplier sets the slope
// there. In linear light the toe and shoulder hold black and white.
export function filmicContrast(
  light: number,
  contrast: number,
  pivot: number,
): number {
  if (light <= 0 || light >= 1 || contrast === 1) return light;
  const origin = Math.log(pivot / (1 - pivot));
  const value = Math.log(light / (1 - light));
  return 1 / (1 + Math.exp(-(origin + contrast * (value - origin))));
}

type ToneGrade = Pick<VideoGrade, "exposure" | "contrast" | "pivot">;

// Neutral-color response of the shader: linear exposure with a soft shoulder,
// followed by contrast. Temperature, tint and saturation affect color.
export function videoToneCurve(light: number, grade: ToneGrade): number {
  const gain = 2 ** grade.exposure;
  const boosted = light * gain;
  const overKnee = Math.max(0, boosted - exposureKnee);
  const exposed =
    Math.min(boosted, exposureKnee) +
    overKnee / (1 + exposureShoulder(gain) * overKnee);
  return Math.min(
    1,
    Math.max(0, filmicContrast(exposed, grade.contrast, grade.pivot)),
  );
}

export function toneCurvePivotInput(grade: ToneGrade): number {
  const gain = 2 ** grade.exposure;
  if (grade.pivot <= exposureKnee) return grade.pivot / gain;
  // Invert the exposure shoulder to find the input that reaches the pivot.
  const overKnee = grade.pivot - exposureKnee;
  return (
    (exposureKnee + overKnee / (1 - exposureShoulder(gain) * overKnee)) / gain
  );
}
