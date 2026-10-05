/**
 * Diverging palettes for "better ↔ worse" columns. Each has a light and a
 * dark ramp, chosen per cell from the background it lands on, so the reader
 * never picks a theme.
 *
 * Ramps run bad → good. A `fade` ramp has no middle color: values near the
 * middle fade to the page background and only the ends carry color. Dark
 * ramps always fade, because a yellow or sand midpoint blended over a dark
 * page turns to olive mud.
 */
import { interpolateLab, piecewise } from "d3-interpolate";
import { interpolateRdYlBu, interpolateRdYlGn } from "d3-scale-chromatic";

export type PaletteId = "brewer" | "calm" | "earth" | "vivid" | "teal" | "colorblind";

export interface Ramp {
  /** Bad → good. With `fade`, exactly two: the bad end and the good end. */
  readonly stops: readonly string[];
  readonly fade: boolean;
}

export interface PaletteSpec {
  readonly label: string;
  readonly note: string;
  readonly light: Ramp;
  readonly dark: Ramp;
}

const sample = (interp: (t: number) => string, n = 9, lo = 0.04, hi = 0.96): string[] =>
  Array.from({ length: n }, (_, i) => interp(lo + ((hi - lo) * i) / (n - 1)));

export const PALETTES: Readonly<Record<PaletteId, PaletteSpec>> = {
  brewer: {
    label: "Brewer",
    note: "ColorBrewer RdYlGn, the classic red–yellow–green",
    light: { stops: sample(interpolateRdYlGn), fade: false },
    dark: { stops: ["#e0533f", "#2fae62"], fade: true },
  },
  calm: {
    label: "Calm",
    note: "Rose and green; middling values stay plain",
    light: { stops: ["#d1495b", "#2a9d6f"], fade: true },
    dark: { stops: ["#ea6476", "#3cb882"], fade: true },
  },
  earth: {
    label: "Earth",
    note: "Terracotta, sand and sage",
    light: { stops: ["#c0583a", "#efe2c2", "#5b8a4e"], fade: false },
    dark: { stops: ["#dc7553", "#86b46f"], fade: true },
  },
  vivid: {
    label: "Vivid",
    note: "Bright red, amber and green",
    light: { stops: ["#ef4444", "#fcd34d", "#22c55e"], fade: false },
    dark: { stops: ["#f87171", "#4ade80"], fade: true },
  },
  teal: {
    label: "Vermilion–teal",
    note: "Easier for red–green color blindness; middling values stay plain",
    light: { stops: ["#d6603b", "#1a8f9c"], fade: true },
    dark: { stops: ["#f07a52", "#2fb6c4"], fade: true },
  },
  colorblind: {
    label: "Red–blue",
    note: "ColorBrewer RdYlBu, safe for red–green color blindness",
    light: { stops: sample(interpolateRdYlBu), fade: false },
    dark: { stops: ["#e0533f", "#6f9bd6"], fade: true },
  },
};

export const DEFAULT_PALETTE: PaletteId = "calm";

export const isPaletteId = (v: unknown): v is PaletteId => typeof v === "string" && v in PALETTES;

/**
 * Color for a position `t` (0 = worst, 1 = best) and how strongly to apply
 * it (0 = leave the background, 1 = full tint).
 */
export const divergingColor = (palette: PaletteId, t: number, dark: boolean): { color: string; weight: number } => {
  const ramp = dark ? PALETTES[palette].dark : PALETTES[palette].light;
  const clamped = Math.min(1, Math.max(0, t));
  if (ramp.fade) {
    const side = clamped < 0.5 ? ramp.stops[0]! : ramp.stops.at(-1)!;
    return { color: side, weight: Math.abs(2 * clamped - 1) ** 0.8 };
  }
  return { color: piecewise(interpolateLab, [...ramp.stops])(clamped), weight: 1 };
};

/** Gradient stops for legends, bad → good. Fading ramps pass through `mid`. */
export const divergingStops = (palette: PaletteId, dark: boolean, mid: string, n = 9): string[] => {
  const ramp = dark ? PALETTES[palette].dark : PALETTES[palette].light;
  if (!ramp.fade) return Array.from({ length: n }, (_, i) => piecewise(interpolateLab, [...ramp.stops])(i / (n - 1)));
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const { color, weight } = divergingColor(palette, t, dark);
    return interpolateLab(mid, color)(weight);
  });
};
