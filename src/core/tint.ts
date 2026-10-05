/**
 * Turning a scale color into a cell background that stays readable on the
 * page it lands on. Pure: callers supply the background and text colors.
 */
import { rgb } from "d3-color";
import { interpolateRgb } from "d3-interpolate";

export const luminance = (c: string): number => {
  const { r, g, b } = rgb(c);
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

export const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** How far to move from the page background toward the scheme color. Dark pages need more to read as color, not mud. */
const tintStrength = (background: string): number => (luminance(background) < 0.2 ? 0.6 : 0.62);

/** WCAG AA is 4.5:1; the extra margin keeps the deepest reds comfortably legible. */
const MIN_CONTRAST = 5;

/**
 * Strongest tint (up to the page's default strength) that keeps text at
 * WCAG AA. Tries the page's own text color first, then near-black or white;
 * mid-tone tints where neither passes are pulled back toward the background.
 * Returns `text: null` when the page's color already works.
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
 * Background (and text override) for one cell: `color` blended over the
 * page by `weight` × the page's default strength, then pulled back if text
 * would fall under the contrast floor.
 */
export const cellFill = (
  color: string,
  weight: number,
  base: string,
  pageText: string,
): { fill: string; text: string | null } => legibleTint(base, color, pageText, tintStrength(base) * weight);

export const isDark = (background: string): boolean => luminance(background) < 0.2;
