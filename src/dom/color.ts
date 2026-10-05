/**
 * Resolves any CSS color the browser understands (oklch, color-mix, named,
 * hsl…) to sRGB by drawing one pixel. d3-color only parses CSS Color 3, so
 * modern computed colors (Tailwind v4 emits oklch) would come back as NaN.
 */
let ctx: CanvasRenderingContext2D | null = null;
const memo = new Map<string, { rgb: string; alpha: number }>();

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
