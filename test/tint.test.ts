import { test } from "node:test";
import assert from "node:assert/strict";
import { divergingColor, PALETTES, type PaletteId } from "../src/core/palettes.ts";
import { cellFill, contrast } from "../src/core/tint.ts";

const pages: ReadonlyArray<readonly [string, string]> = [
  ["rgb(255, 255, 255)", "rgb(34, 34, 34)"],
  ["rgb(246, 243, 238)", "rgb(0, 0, 238)"], // link-blue text on cream
  ["rgb(15, 17, 21)", "rgb(230, 230, 230)"],
  ["rgb(15, 17, 21)", "rgb(154, 163, 178)"], // muted text on dark
  ["rgb(161, 136, 252)", "rgb(32, 33, 34)"], // Wikipedia category purple
];

test("every palette, every step, every page: text stays at 5:1 or the cell is left plain", () => {
  for (const [base, text] of pages) {
    const dark = base.startsWith("rgb(15");
    for (const id of Object.keys(PALETTES) as PaletteId[]) {
      for (let i = 0; i <= 20; i++) {
        const { color, weight } = divergingColor(id, i / 20, dark);
        const out = cellFill(color, weight, base, text);
        const shown = out.text ?? text;
        assert.ok(contrast(out.fill, shown) >= 5 || out.fill === base, `${id} ${base} t=${i / 20} → ${out.fill} with ${shown}`);
      }
    }
  }
});
