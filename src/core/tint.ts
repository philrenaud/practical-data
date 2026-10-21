/**
 * Turns a scale color into a cell background that keeps the cell's text
 * readable. Callers supply the page's background and text colors.
 */
import { rgb } from "d3-color";
import { interpolateRgb } from "d3-interpolate";

/** The WCAG 2 relative luminance of a CSS color, from 0 to 1. */
export const luminance = (c: string): number => {
  const { r, g, b } = rgb(c);
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

/** The WCAG 2 contrast ratio of two CSS colors, from 1 to 21. */
export const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** How far to move from the page background toward the scheme color, at full weight. */
const tintStrength = (background: string): number => (luminance(background) < 0.2 ? 0.6 : 0.62);

/** WCAG AA is 4.5:1. The extra margin keeps text on the deepest reds legible. */
const MIN_CONTRAST = 5;

/**
 * The strongest tint, up to `start`, that keeps text above MIN_CONTRAST. Each
 * step tries the page's own text color first, then near-black or white. A
 * mid-tone tint where neither passes moves back toward the background.
 * `text` is null when the page's text color passes.
 */
const legibleTint = (
  base: string,
  scheme: string,
  pageText: string,
  start = tintStrength(base),
): { fill: string; text: string | null } => {
  const mix = interpolateRgb(base, scheme);
  for (let strength = start; strength > 0; strength -= 0.04) {
    const fill = mix(strength);
    if (contrast(fill, pageText) >= MIN_CONTRAST) return { fill, text: null };
    const alt = contrast(fill, "#111") >= contrast(fill, "#fff") ? "#111" : "#fff";
    if (contrast(fill, alt) >= MIN_CONTRAST) return { fill, text: alt };
  }
  return { fill: base, text: null };
};

/**
 * The background for one cell, and a text color when the page's own fails.
 * The fill is `color` blended over the page by `weight` times the default
 * strength, then moved back toward the page if text would fall under
 * MIN_CONTRAST.
 */
export const cellFill = (
  color: string,
  weight: number,
  base: string,
  pageText: string,
): { fill: string; text: string | null } => legibleTint(base, color, pageText, tintStrength(base) * weight);

/** True for a background dark enough to take a palette's dark ramp. */
export const isDark = (background: string): boolean => luminance(background) < 0.2;
