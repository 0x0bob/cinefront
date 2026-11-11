// Same estimate as pipeline/scene_api/pipeline.py: tokens = w*h*seconds*24/1024 * 1.003, square 1:1 clips with the pixel area of 16:9 (720p -> 960x960, 1080p -> 1440x1440).
export const DURATIONS = [5, 10, 15] as const;
export const RESOLUTIONS = ["720p", "1080p"] as const;
export type Duration = (typeof DURATIONS)[number];
export type Resolution = (typeof RESOLUTIONS)[number];
const SIDE: Record<Resolution, number> = { "720p": 960, "1080p": 1440 };
export const TOKEN_RATIO = 1.003;

export function estimate(duration: number, resolution: Resolution, pricePerMtoken: number) {
  const side = SIDE[resolution];
  const tokens = Math.round(((side * side * duration * 24) / 1024) * TOKEN_RATIO);
  return { tokens, costUsd: Math.round((tokens / 1e6) * pricePerMtoken * 100) / 100 };
}
