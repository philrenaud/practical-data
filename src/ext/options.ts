/** Options page: credentials, palette with a live preview, per-site switches. */
import { select } from "d3-selection";
import { Effect } from "effect";
import { DEFAULT_PALETTE, divergingStops, isPaletteId, PALETTES, type PaletteId as Palette } from "../core/palettes.ts";
import { positions, schemeColor } from "../core/scale.ts";
import { cellFill, isDark } from "../core/tint.ts";
import type { ColumnEncoding, PageSnapshot, TableJudgment } from "../core/types.ts";
import { judgePage } from "../decide/judge.ts";
import { layerFromConfig } from "../decide/model.ts";
import { DEFAULT_SETTINGS, loadSettings, providerConfig, saveSettings, setSiteEnabledIn, type Settings } from "./settings.ts";

const SAMPLE: PageSnapshot = {
  url: "chrome-extension://options",
  title: "LLM API pricing",
  tables: [
    {
      id: "t0",
      title: "Per million tokens",
      headers: ["Model", "Category", "Input", "Output", "Context window"],
      rows: [
        ["Nimbus mini", "Lightweight", "$0.15", "$0.60", "128K"],
        ["Nimbus", "Versatile", "$2.50", "$10.00", "256K"],
        ["Nimbus pro", "Powerful", "$15.00", "$60.00", "1M"],
        ["Cirrus flash", "Lightweight", "$0.08", "$0.30", "1M"],
        ["Cirrus", "Versatile", "$1.25", "$5.00", "2M"],
      ],
    },
  ],
};

const evidence = { comparable: 1, polarity: { higher_is_better: 0, lower_is_better: 1, neutral: 0 }, log: 1, orderConfidence: 1 };

/** What a typical judgment of SAMPLE looks like, so the preview renders before any key exists. */
const EXAMPLE: TableJudgment = {
  id: "t0",
  orientation: "columns",
  rowsScore: null,
  aggregateRows: [],
  skipped: [],
  encodings: [
    { kind: "ordinal", col: 1, header: "Category", polarity: "neutral", order: ["lightweight", "versatile", "powerful"], labels: ["Lightweight", "Versatile", "Powerful"], values: ["lightweight", "versatile", "powerful", "lightweight", "versatile"], group: null, evidence },
    { kind: "quantitative", col: 2, header: "Input", polarity: "lower_is_better", transform: "log", unit: "$", domain: [0.08, 15], values: [0.15, 2.5, 15, 0.08, 1.25], group: null, evidence },
    { kind: "quantitative", col: 3, header: "Output", polarity: "lower_is_better", transform: "log", unit: "$", domain: [0.3, 60], values: [0.6, 10, 60, 0.3, 5], group: null, evidence },
    { kind: "quantitative", col: 4, header: "Context window", polarity: "higher_is_better", transform: "log", unit: null, domain: [128e3, 2e6], values: [128e3, 256e3, 1e6, 1e6, 2e6], group: null, evidence },
  ],
};

const form = document.querySelector("main")!;
const statusEl = document.querySelector<HTMLOutputElement>("#status")!;
let judgment: TableJudgment = EXAMPLE;

const field = <T extends HTMLInputElement | HTMLSelectElement>(name: string) =>
  form.querySelector<T>(`[name="${name}"]:not([type=radio])`)!;
const radio = (name: string) => form.querySelector<HTMLInputElement>(`[name="${name}"]:checked`)?.value;

const setStatus = (text: string, error = false) => {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", error);
};

const read = (base: Settings): Settings => ({
  ...base,
  provider: radio("provider") === "clef" ? "clef" : "jev",
  palette: currentPalette(),
  typesafeApiKey: field("typesafeApiKey").value.trim(),
  cloudflareAccountId: field("cloudflareAccountId").value.trim(),
  cloudflareApiToken: field("cloudflareApiToken").value.trim(),
  clefModel: field("clefModel").value === "clef-flash" ? "clef-flash" : "clef",
  mode: radio("mode") === "chosen" ? "chosen" : "everywhere",
});

const write = (s: Settings) => {
  form.querySelector<HTMLInputElement>(`[name=provider][value=${s.provider}]`)!.checked = true;
  form.querySelector<HTMLInputElement>(`[name=palette][value=${s.palette}]`)!.checked = true;
  form.querySelector<HTMLInputElement>(`[name=mode][value=${s.mode}]`)!.checked = true;
  field("typesafeApiKey").value = s.typesafeApiKey;
  field("cloudflareAccountId").value = s.cloudflareAccountId;
  field("cloudflareApiToken").value = s.cloudflareApiToken;
  field("clefModel").value = s.clefModel;
  syncProvider();
  renderHosts(s);
};

const syncProvider = () => {
  const provider = radio("provider");
  form.querySelectorAll<HTMLElement>(".fields").forEach((el) => {
    el.hidden = el.dataset["for"] !== provider;
  });
};

const currentPalette = (): Palette => {
  const v = radio("palette");
  return isPaletteId(v) ? v : DEFAULT_PALETTE;
};

const gradient = (stops: readonly string[]) => `linear-gradient(90deg, ${stops.join(", ")})`;

/** One card per palette, with its light and dark ramps side by side. */
const renderPalettes = () => {
  select("#palettes")
    .selectAll("label")
    .data(Object.entries(PALETTES))
    .join((enter) => {
      const label = enter.append("label").attr("class", "palette");
      label.append("input").attr("type", "radio").attr("name", "palette").attr("value", ([id]) => id);
      label.append("b").text(([, p]) => p.label);
      const sw = label.append("div").attr("class", "swatches");
      sw.append("span").attr("title", "Light pages").style("background", ([id]) => gradient(divergingStops(id as Palette, false, "#ece8e1")));
      sw.append("span").attr("title", "Dark pages").style("background", ([id]) => gradient(divergingStops(id as Palette, true, "#26252b")));
      label.append("small").text(([, p]) => p.note);
      return label;
    });
};

const renderPreview = () => {
  const palette = currentPalette();
  const table = SAMPLE.tables[0]!;
  const style = getComputedStyle(document.body);
  const panel = style.getPropertyValue("--panel").trim() || "#fff";
  const ink = style.getPropertyValue("--ink").trim() || "#111";
  const byCol = new Map<number, ColumnEncoding>(judgment.encodings.map((e) => [e.col, e]));
  const ts = new Map([...byCol].map(([c, e]) => [c, positions(e)]));
  const dark = isDark(panel);

  const t = select("#preview");
  t.selectAll("*").remove();
  t.append("thead").append("tr").selectAll("th").data(table.headers).join("th").text((d) => d);
  t.append("tbody")
    .selectAll("tr")
    .data(table.rows)
    .join("tr")
    .selectAll("td")
    .data((row, r) =>
      row.map((text, c) => {
        const e = byCol.get(c);
        const t = ts.get(c)?.[r] ?? null;
        const tint = e === undefined || t === null ? null : schemeColor(e, palette, t, dark);
        return {
          text,
          numeric: e?.kind === "quantitative",
          fill: tint === null ? null : cellFill(tint.color, tint.weight, panel, ink),
        };
      }),
    )
    .join("td")
    .classed("num", (d) => d.numeric)
    .style("background", (d) => d.fill?.fill ?? null)
    .style("color", (d) => d.fill?.text ?? null)
    .text((d) => d.text);
};

const renderHosts = (s: Settings) => {
  const everywhere = s.mode === "everywhere";
  const hosts = everywhere ? s.disabledHosts : s.enabledHosts;
  document.querySelector("#hosts-note")!.textContent = everywhere ? "Turned off on:" : "Turned on for:";
  select("#hosts")
    .selectAll("li")
    .data(hosts)
    .join((enter) => {
      const li = enter.append("li");
      li.append("span");
      li.append("button").attr("type", "button").text("×");
      return li;
    })
    .call((li) => li.select("span").text((d) => d))
    .call((li) =>
      li
        .select("button")
        .attr("aria-label", (d) => (everywhere ? `Turn ${d} back on` : `Turn ${d} off`))
        .on("click", async (_, host) => {
          const next = setSiteEnabledIn(await loadSettings(), host, everywhere);
          await saveSettings(next);
          renderHosts(next);
        }),
    );
};

const test = async () => {
  const config = providerConfig(read(await loadSettings()));
  if (config === null) {
    setStatus("Add credentials first.", true);
    return;
  }
  setStatus("Asking the model…");
  const started = performance.now();
  const result = await Effect.runPromise(
    judgePage(SAMPLE).pipe(Effect.provide(layerFromConfig(config)), Effect.result),
  );
  if (result._tag === "Failure") {
    setStatus(`${result.failure.reason}: ${result.failure.message}`, true);
    return;
  }
  judgment = result.success.tables[0]!;
  renderPreview();
  const ms = Math.round(performance.now() - started);
  setStatus(`${result.success.model} judged ${judgment.encodings.length} of 5 columns in ${ms} ms (${result.success.usage.inputTokens} tokens).`);
  document.querySelector("#preview-note")!.textContent = "Preview shows the model's live judgment.";
};

form.addEventListener("change", async () => {
  syncProvider();
  renderPreview();
  renderHosts(read(await loadSettings()));
});
document.querySelector("#save")!.addEventListener("click", async () => {
  await saveSettings(read(await loadSettings()));
  setStatus("Saved.");
});
document.querySelector("#test")!.addEventListener("click", () => void test());
document.querySelector("#clear")!.addEventListener("click", async () => {
  const keys = Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith("answers:"));
  await chrome.storage.local.remove(keys);
  setStatus(`Cleared ${keys.length} cached answer${keys.length === 1 ? "" : "s"}.`);
});

document.querySelector("#build")!.textContent = `Build ${chrome.runtime.getManifest().version_name ?? chrome.runtime.getManifest().version}`;
renderPalettes();
write(await loadSettings().catch(() => DEFAULT_SETTINGS));
renderPreview();
