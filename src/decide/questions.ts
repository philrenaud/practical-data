/**
 * Question builders. Each builder returns the questions it needs plus a
 * reader that turns the answers back into a typed result, so question ids
 * never leak past this file.
 *
 * Division of labor (per Jev's documented jaggedness): code computes every
 * number — extents, spread, sequence detection — and hands the model words.
 * The model judges meaning: is this an amount, which direction is good, does
 * the quantity behave multiplicatively, what order do these labels follow.
 */
import type { CategoricalProfile, ColumnProfile, NumericProfile, TextProfile } from "../core/profile.ts";
import { describeSpread } from "../core/profile.ts";
import type { Polarity } from "../core/types.ts";
import type { Answer, Question } from "./model.ts";

export type Answers = Readonly<Record<string, Answer>>;

export const noul = (answers: Answers, id: string): number => {
  const a = answers[id];
  return a?.type === "noul" ? a.noul : 0;
};

export const probabilities = (answers: Answers, id: string): Readonly<Record<string, number>> => {
  const a = answers[id];
  return a !== undefined && a.type !== "noul" ? a.probabilities : {};
};

// ── State ───────────────────────────────────────────────────────────────────

export interface TableContext {
  readonly page: string;
  readonly table: string | null;
}

/** The JSON a column is described as. `columns[k]` in prose points into this. */
const describeColumn = (p: NumericProfile | CategoricalProfile) => {
  if (p.kind === "numeric") {
    const notes: string[] = [];
    if (p.isSequence) notes.push("the values are exactly 1, 2, 3, … in row order");
    if (p.looksLikeYears) {
      notes.push(
        p.rangeShare >= 0.5
          ? "the values are spans of calendar years, such as 1950-1954"
          : "every value is a whole number between 1800 and 2100",
      );
    }
    if (p.boundShare >= 0.5) notes.push("most values are written as bounds with ≤, <, ≥, >, or + rather than exact amounts");
    if (p.rangeShare >= 0.5) notes.push("most values are written as two numbers joined by a dash, such as 20-25");
    if (p.durationShare >= 0.5) {
      notes.push("values are written like clock readings (such as 2:41); they could be durations or times of day");
    }
    return {
      header: p.header,
      kind: "number",
      ...(p.unit === null ? {} : { unit: p.unit }),
      examples: p.samples,
      spread: describeSpread(p),
      ...(notes.length > 0 ? { notes } : {}),
    };
  }
  return { header: p.header, kind: "label", values: p.levels.map((l) => p.display[l] ?? l) };
};

/** First text column: tells the model what each row *is* (players, models, countries). */
const rowLabelColumn = (profiles: readonly ColumnProfile[]): TextProfile | undefined =>
  profiles.find((p): p is TextProfile => p.kind === "text" && p.reason === "every value is unique");

export const tableState = (
  ctx: TableContext,
  profiles: readonly ColumnProfile[],
  candidates: readonly (NumericProfile | CategoricalProfile)[],
) => {
  const rowLabel = rowLabelColumn(profiles);
  return {
    page_title: ctx.page,
    table_title: ctx.table,
    ...(rowLabel === undefined ? {} : { rows_are: { header: rowLabel.header, examples: rowLabel.samples } }),
    columns: candidates.map(describeColumn),
  };
};

// ── Orientation ─────────────────────────────────────────────────────────────

/**
 * Whether values compare down columns (each column is one measure) or across
 * rows (each row is one measure, each column one item). Asked speculatively
 * in the table request; a "rows" answer triggers a transposed second pass.
 */
export const orientationQuestion = (firstColumn: { header: string; examples: readonly string[] }) => {
  const id = "table.orientation";
  const question: Question = {
    type: "choice",
    instructions: {
      first_column: firstColumn,
      question:
        "Which values in this table are meant to be compared with each other: the values down each column, or the values across each row? `first_column` shows what each row is.",
    },
    criteria: {
      columns:
        "The column headers name measures (such as Price, Input, ERA, Population) and the first column names the items being compared (such as products, players, models or countries), so values down a column share units and meaning.",
      rows: "The column headers name the items being compared and the first column names measures or tests (such as benchmark names, metrics or survey questions), so values across a row share units and meaning.",
    },
  };
  const read = (answers: Answers): number => probabilities(answers, id)["rows"] ?? 0;
  return { questions: { [id]: question } as Record<string, Question>, read };
};

// ── Shared criteria ─────────────────────────────────────────────────────────

const POLARITY_CRITERIA: Readonly<Record<Polarity, string>> = {
  higher_is_better:
    "A reader would generally prefer rows with larger values (for example home runs, battery life, rating, revenue, wins).",
  lower_is_better:
    "A reader would generally prefer rows with smaller values (for example price, cost, latency, ERA, errors, losses, time taken).",
  neutral:
    "Neither direction is generally preferable; larger is just different (for example height, population, year, weight, count of items).",
};

const readPolarity = (answers: Answers, id: string): Record<Polarity, number> => {
  const p = probabilities(answers, id);
  return {
    higher_is_better: p["higher_is_better"] ?? 0,
    lower_is_better: p["lower_is_better"] ?? 0,
    neutral: p["neutral"] ?? 1,
  };
};

// ── Numeric columns ─────────────────────────────────────────────────────────

export interface NumericReading {
  readonly measure: number;
  readonly role: string;
  readonly polarity: Record<Polarity, number>;
  /** Null when the spread is too small for a log scale to matter. */
  readonly log: number | null;
}

/** Only ask about log scales when the data could plausibly use one. */
export const logEligible = (p: NumericProfile): boolean => p.decades !== null && p.decades >= 1;

export const numericQuestions = (k: number, p: NumericProfile) => {
  const ref = `the column \`columns[${k}]\` ("${p.header}")`;
  const id = (q: string) => `n${p.col}.${q}`;
  const questions: Record<string, Question> = {
    [id("role")]: {
      type: "choice",
      instructions: `What kind of numbers are in ${ref}?`,
      criteria: {
        measure:
          "An amount that differs between rows and is meaningful to compare: a price, count, statistic, rate, percentage, size, rating, score, or a duration such as a game length of 2:59.",
        identifier:
          "A label that only happens to be numeric: an ID, code, model or version number, jersey number, or catalog number.",
        time: "A year, season, date, age, or time of day (such as a 7:05 start time) used to place a row in time.",
        rank: "A position in a ranked list (1st, 2nd, 3rd, …) rather than an amount.",
        bins: "Brackets that group the rows into ordered ranges of one amount, such as ages 20-25, 26-30, 65+ or incomes $0-$25k. Spans of years such as 1950-1954 are time, not bins.",
        record:
          "Two counts written together, like a win-loss record (12-4) or a game score (35-10), rather than a range of one amount.",
        threshold:
          "A cutoff or boundary that says which rule, tier, or price applies (for example ≤ 272K tokens), rather than an amount the row has.",
      },
    },
    [id("polarity")]: {
      type: "choice",
      instructions: `For a typical reader of this table, is a higher value in ${ref} better or worse?`,
      criteria: POLARITY_CRITERIA,
    },
  };
  if (logEligible(p)) {
    questions[id("log")] = {
      type: "noul",
      instructions: `Is ${ref} a quantity where ratios between rows matter more than differences (for example a price that is 10 times another, or a population), so a logarithmic color scale would show it better than a linear one?`,
    };
  }
  const read = (answers: Answers): NumericReading => {
    const role = probabilities(answers, id("role"));
    const roleAnswer = answers[id("role")];
    return {
      // Brackets are shaded like amounts, by their midpoints.
      measure: (role["measure"] ?? 0) + (role["bins"] ?? 0),
      role: roleAnswer?.type === "choice" ? roleAnswer.choice : "unknown",
      polarity: readPolarity(answers, id("polarity")),
      log: logEligible(p) ? noul(answers, id("log")) : null,
    };
  };
  return { questions, read };
};

// ── Categorical columns ─────────────────────────────────────────────────────

export interface CategoricalReading {
  /** P(the labels are ordered levels of one property). */
  readonly ordinal: number;
  readonly relation: string;
  readonly polarity: Record<Polarity, number>;
  /** P(labels[i] is the lower grade than labels[j]), for i < j. */
  readonly lower: (i: number, j: number) => number;
}

/**
 * One Choice per pair of labels: which is the lower grade. Pairwise questions
 * beat "what position is X" once there are more than three levels, and the
 * direction must be anchored in the criteria; "earlier" alone flips on
 * catalogs that list the flagship first. Each pair is asked in both
 * orientations and averaged, which cancels a preference for slot `a`.
 */
export const pairQuestions = (prefix: string, ref: string, labels: readonly string[]) => {
  const ask = (a: string, b: string): Question => ({
    type: "choice",
    instructions: {
      a,
      b,
      question: `The values of ${ref} are grades of one property. Which of \`a\` and \`b\` is the lower grade?`,
    },
    criteria: {
      a: `"${a}" is the lower grade: smaller, weaker, cheaper, less severe, more common, or more basic than "${b}".`,
      b: `"${b}" is the lower grade: smaller, weaker, cheaper, less severe, more common, or more basic than "${a}".`,
    },
  });
  const questions: Record<string, Question> = {};
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      questions[`${prefix}.lt${i}_${j}`] = ask(labels[i]!, labels[j]!);
      questions[`${prefix}.lt${j}_${i}`] = ask(labels[j]!, labels[i]!);
    }
  }
  const read =
    (answers: Answers) =>
    (i: number, j: number): number => {
      const forward = probabilities(answers, `${prefix}.lt${i}_${j}`)["a"] ?? 0.5;
      const reverse = probabilities(answers, `${prefix}.lt${j}_${i}`)["b"] ?? 0.5;
      return (forward + reverse) / 2;
    };
  return { questions, read };
};

/**
 * Categorical columns get their own request with only that column's values in
 * state (in the full-table state, pairwise orders degraded: C < M < U < R),
 * plus the sibling headers for context.
 */
export const categoricalState = (ctx: TableContext, p: CategoricalProfile, siblings: readonly string[]) => ({
  page_title: ctx.page,
  table_title: ctx.table,
  column: describeColumn(p),
  // The other headers say what the table is about ("Input", "Output" → model tiers), which
  // lifted the ordered-levels call for Lightweight/Versatile/Powerful from 0.67 to 0.85.
  other_columns: siblings,
});

export const categoricalQuestions = (p: CategoricalProfile) => {
  const ref = `the column \`column\` ("${p.header}")`;
  const id = (q: string) => `c${p.col}.${q}`;
  const labels = p.levels.map((l) => p.display[l] ?? l);
  const pairs = pairQuestions(`c${p.col}`, ref, labels);
  const questions: Record<string, Question> = {
    // A Choice, not a Noul: naming the alternatives (statuses, options) is
    // what keeps "GA / Preview" and "Default / Long context" out.
    [id("relation")]: {
      type: "choice",
      instructions: `How do the values of ${ref} relate to each other?`,
      criteria: {
        ordered_levels:
          "They are levels or grades of one property that most readers would put in the same order (sizes, tiers, severities, rarities, priorities, ratings).",
        unordered_kinds:
          "They are names, kinds, places, or groups with no inherent order (teams, regions, colors, weather types, leagues).",
        workflow_states: "They are stages or statuses of a process (open, in progress, done; preview, released).",
        options: "They are alternative options or modes where neither is more of anything (default vs custom).",
        scores_or_records:
          "They are game scores or win-loss records written as two numbers (35-10, 12-4).",
        names_or_versions:
          "They are names or versions of specific products, models, or items (Grok 4.5, Grok 4.6; iPhone 14, iPhone 15), even if the names contain numbers.",
      },
    },
    [id("polarity")]: {
      type: "choice",
      instructions: `For a typical reader of this table, is a higher grade in ${ref} better or worse?`,
      criteria: POLARITY_CRITERIA,
    },
  };
  const read = (answers: Answers): CategoricalReading => {
    const relation = answers[id("relation")];
    return {
      ordinal: probabilities(answers, id("relation"))["ordered_levels"] ?? 0,
      relation: relation?.type === "choice" ? relation.choice : "unknown",
      polarity: readPolarity(answers, id("polarity")),
      lower: pairs.read(answers),
    };
  };
  /**
   * Relation and polarity first; the pairwise questions (n² for n levels) go
   * in a second request, only when the labels might be ordered.
   */
  return { questions, pairQuestions: pairs.questions, ordinalOf: (a: Answers) => probabilities(a, id("relation"))["ordered_levels"] ?? 0, read };
};

// ── Aggregate rows ──────────────────────────────────────────────────────────

/**
 * Totals and averages sit at the top or bottom of a table. Asking about the
 * first and last two rows covers "World", "Total", "League average", "Career".
 */
export const aggregateCandidates = (rowCount: number): number[] =>
  rowCount < 5 ? [] : [...new Set([0, 1, rowCount - 2, rowCount - 1])];

export const aggregateQuestions = (headers: readonly string[], rows: readonly (readonly string[])[]) => {
  const candidates = aggregateCandidates(rows.length);
  const questions: Record<string, Question> = Object.fromEntries(
    candidates.map((r) => [
      `row${r}.aggregate`,
      {
        type: "noul",
        instructions: {
          row: Object.fromEntries(headers.map((h, c) => [h || `column ${c + 1}`, rows[r]?.[c] ?? ""])),
          question:
            "Is `row` a total, average, or other summary of the table's other rows (such as Total, World, League average, Career, or All), rather than one individual entry?",
        },
      } satisfies Question,
    ]),
  );
  const read = (answers: Answers, threshold: number): number[] =>
    candidates.filter((r) => noul(answers, `row${r}.aggregate`) >= threshold);
  return { questions, read };
};

// ── Cross-table groups ──────────────────────────────────────────────────────

export interface GroupMember {
  readonly table: string | null;
  readonly header: string;
  readonly unit: string | null;
  readonly examples: readonly string[];
}

export const shareQuestion = (kind: "quantitative" | "ordinal", members: readonly GroupMember[]): Question => ({
  type: "noul",
  instructions: {
    columns: members.map((m) => ({
      table: m.table,
      header: m.header,
      ...(m.unit === null ? {} : { unit: m.unit }),
      [kind === "ordinal" ? "grades" : "examples"]: m.examples,
    })),
    question:
      kind === "ordinal"
        ? "These columns come from different tables on the same page. Do all of `columns` grade the same property using labels from one shared scale (a table may use only some of the levels), so that one shared color scale would let a reader compare grades across the tables?"
        : "These columns come from different tables on the same page. Do all of `columns` measure the same quantity in the same units, so that putting them on one shared color scale would let a reader compare values across the tables?",
  },
});
