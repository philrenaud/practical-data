let ctx: CanvasRenderingContext2D | null = null;
const memo = new Map<string, { rgb: string; alpha: number }>();

/**
 * Returns the sRGB color and the alpha of any CSS color the browser can parse,
 * such as oklch(), color-mix(), or a named color. The color is drawn to a
 * one-pixel canvas and read back. d3-color parses only CSS Color 3, so it
 * returns NaN channels for the oklch() colors that Tailwind v4 emits.
 */
export const resolveColor = (css: string): { rgb: string; alpha: number } => {
  const hit = memo.get(css);
  if (hit !== undefined) return hit;
  ctx ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  let out = { rgb: "rgb(0, 0, 0)", alpha: 0 };
  if (ctx !== null) {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "rgba(0, 0, 0, 0)";
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(0, 0, 1, 1).data;
    out = { rgb: `rgb(${r}, ${g}, ${b})`, alpha: a / 255 };
  }
  if (memo.size > 500) memo.clear();
  memo.set(css, out);
  return out;
};
