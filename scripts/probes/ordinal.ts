/**
 * Probe: compares question designs for ordinal detection and ordering on real
 * columns. Not part of the eval; used to pick the design that the eval scores.
 */
import { Effect } from "effect";
import { jev } from "../../src/decide/model.ts";
import type { Question } from "../../src/decide/model.ts";

const all: { header: string; values: string[]; context: string; ordinal: boolean; order?: string[] }[] = [
  { header: "Category", values: ["Lightweight", "Powerful", "Versatile"], context: "GitHub Copilot models and pricing", ordinal: true, order: ["Lightweight", "Versatile", "Powerful"] },
  { header: "Tier", values: ["Default", "Long context"], context: "GitHub Copilot models and pricing", ordinal: false },
  { header: "Release status", values: ["GA", "Public preview"], context: "GitHub Copilot models and pricing", ordinal: false },
  { header: "Tier", values: ["Flagship", "High-end", "Mid-range", "Entry"], context: "GPU benchmarks", ordinal: true, order: ["Entry", "Mid-range", "High-end", "Flagship"] },
  { header: "R", values: ["C", "U", "R", "M"], context: "Bloomburrow (BLB) Magic: The Gathering card checklist", ordinal: true, order: ["C", "U", "R", "M"] },
  { header: "Storm classification at peak intensity", values: ["Category 5 hurricane", "Category 4 hurricane", "Tropical storm", "Category 3 hurricane", "Category 1 hurricane", "Category 2 hurricane"], context: "Costliest Atlantic hurricanes", ordinal: true, order: ["Tropical storm", "Category 1 hurricane", "Category 2 hurricane", "Category 3 hurricane", "Category 4 hurricane", "Category 5 hurricane"] },
  { header: "Status", values: ["Investigating", "Open", "Resolved"], context: "Incident queue", ordinal: false },
  { header: "Conditions", values: ["Snow", "Sunny", "Cloudy", "Rain"], context: "Weekly temperature change", ordinal: false },
  { header: "Lg", values: ["AL", "NL"], context: "Standard Pitching Table", ordinal: false },
  { header: "Region", values: ["Mosel", "Bordeaux", "Burgundy", "Alsace"], context: "Wine list", ordinal: false },
  { header: "Size", values: ["M", "XS", "XL", "S", "L"], context: "Apparel sizes", ordinal: true, order: ["XS", "S", "M", "L", "XL"] },
  { header: "Rarity", values: ["Mythic", "Rare", "Uncommon", "Common", "Special"], context: "Modern price index", ordinal: true },
];

const model = jev(process.env["TYPESAFE_API_KEY"]!);

const isOrdinalVariants = (h: string): Record<string, Question> => ({
  noul_plain: { type: "noul", instructions: `Do the values of the column \`column\` ("${h}") form a natural progression from less to more of one property, the way small < medium < large or Common < Uncommon < Rare do?` },
  choice_relation: {
    type: "choice",
    instructions: `How do the values of the column \`column\` ("${h}") relate to each other?`,
    criteria: {
      ordered_levels: "They are levels or grades of one property that most readers would put in the same order (sizes, tiers, severities, rarities, priorities, ratings).",
      unordered_kinds: "They are names, kinds, places, or groups with no inherent order (teams, regions, colors, weather types, leagues).",
      workflow_states: "They are stages or statuses of a process (open, in progress, done; preview, released).",
      options: "They are alternative options or modes where neither is more of anything (default vs custom).",
    },
  },
});

const pairwise = (h: string, values: string[]): Record<string, Question> => {
  const qs: Record<string, Question> = {};
  values.forEach((a, i) =>
    values.forEach((b, j) => {
      if (i < j) {
        qs[`p${i}_${j}`] = {
          type: "choice",
          instructions: { a, b, question: `The values of the column \`column\` ("${h}") are grades of one property. Which of \`a\` and \`b\` is the lower grade?` },
          criteria: {
            a: `"${a}" is the lower grade: smaller, weaker, cheaper, less severe, more common, or more basic than "${b}".`,
            b: `"${b}" is the lower grade: smaller, weaker, cheaper, less severe, more common, or more basic than "${a}".`,
          },
        };
      }
    }),
  );
  return qs;
};

const columns = all.filter((c) => c.ordinal);
for (const c of columns) {
  const state = { page_title: c.context, column: { header: c.header, values: c.values } };
  const r = await Effect.runPromise(
    model.evaluate({ state, questions: { ...isOrdinalVariants(c.header), ...(c.ordinal ? pairwise(c.header, c.values) : {}) } }),
  );
  const a = r.answers;
  const n = a["noul_plain"]!;
  const ch = a["choice_relation"]!;
  let order = "";
  if (c.ordinal) {
    const wins = c.values.map(() => 0);
    c.values.forEach((_, i) =>
      c.values.forEach((_, j) => {
        if (i < j) {
          const ans = a[`p${i}_${j}`]!;
          const pa = ans.type === "choice" ? (ans.probabilities["a"] ?? 0) : 0;
          wins[i]! += pa;
          wins[j]! += 1 - pa;
        }
      }),
    );
    order = c.values.map((v, i) => [v, wins[i]!] as const).sort((x, y) => y[1] - x[1]).map((x) => x[0]).join(" < ");
    const ok = c.order === undefined ? "?" : order === c.order.join(" < ") ? "✓" : "✗";
    order = `${ok} ${order}`;
  }
  console.log(
    `${(c.ordinal ? "ORD " : "    ") + c.header.slice(0, 22).padEnd(22)} noul=${n.type === "noul" ? n.noul.toFixed(2) : ""}  choice=${ch.type === "choice" ? `${ch.choice}(${(ch.probabilities["ordered_levels"] ?? 0).toFixed(2)})` : ""}  ${order}`,
  );
}
