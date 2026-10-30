/**
 * Builds the questions sent to the decision model and reads the answers.
 * Each builder returns its questions and a `read` function that turns the
 * answers into a typed result.
 *
 * Jev is weak at arithmetic and counting. Code computes every number, such as
 * extents, spread, and sequence detection, and describes it to the model in
 * words. The model judges meaning: whether a column is an amount, which
 * direction is better, whether ratios matter, and what order labels follow.
 *
 * Every string here is part of a request body. Recordings in
 * fixtures/recordings are keyed by a hash of that body. src/api/allow.ts
 * builds the hosted endpoint's allowlist from these builders, so the deployed
 * Worker accepts only the wording it was built with. A wording change needs
 * new recordings and a Worker deploy.
 */
import type { CategoricalProfile, ColumnProfile, NumericProfile, TextProfile } from "../core/profile.ts";
import { describeSpread } from "../core/profile.ts";
import type { Polarity } from "../core/types.ts";
import type { Answer, Question } from "./model.ts";

/** Answers by question id. */
export type Answers = Readonly<Record<string, Answer>>;

/** Returns the Noul probability for question `id`, or 0 when there is no Noul answer. */
export const noul = (answers: Answers, id: string): number => {
  const a = answers[id];
  return a?.type === "noul" ? a.noul : 0;
};

/** Returns the option probabilities for question `id`, or an empty record when there are none. */
export const probabilities = (answers: Answers, id: string): Readonly<Record<string, number>> => {
  const a = answers[id];
  return a !== undefined && a.type !== "noul" ? a.probabilities : {};
};

// ── State ───────────────────────────────────────────────────────────────────

/** The page and table titles that go in each request's state. */
export interface TableContext {
  readonly page: string;
  readonly table: string | null;
}

/** Describes one column as JSON for the state. Question text refers to it as `columns[k]` or `column`. */
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
    if (p.boundShare >= 0.5)
      notes.push("most values are written as bounds with ≤, <, ≥, >, or + rather than exact amounts");
    if (p.rangeShare >= 0.5) notes.push("most values are written as two numbers joined by a dash, such as 20-25");
    if (p.unit === "streak")
      notes.push("the values are win or loss streaks, counted as wins minus losses: W3 is 3, L2 is -2");
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

/**
 * Returns the first text column whose values are all different. Its samples
 * tell the model what each row is, such as players, models, or countries.
 */
const rowLabelColumn = (profiles: readonly ColumnProfile[]): TextProfile | undefined =>
  profiles.find((p): p is TextProfile => p.kind === "text" && p.reason === "every value is unique");

/** Returns the state for a table request: the titles, the row labels, and the candidate columns. */
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
 * Asks whether values compare down each column or across each row. In the
 * second case, each row is one measure and each column is one item. The
 * question goes in the table request, before the answer is needed. `read`
 * returns P(rows).
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

/** A missing polarity answer reads as neutral. */
const readPolarity = (answers: Answers, id: string): Record<Polarity, number> => {
  const p = probabilities(answers, id);
  return {
    higher_is_better: p["higher_is_better"] ?? 0,
    lower_is_better: p["lower_is_better"] ?? 0,
    neutral: p["neutral"] ?? 1,
  };
};

// ── Numeric columns ─────────────────────────────────────────────────────────

/** The answers about one numeric column. */
export interface NumericReading {
  /** P(the column is an amount worth shading). Bins and ranks count unless they repeat the rows. */
  readonly measure: number;
  /** The most likely role, such as "measure" or "identifier". */
  readonly role: string;
  readonly polarity: Record<Polarity, number>;
  /** Null when the spread is too small for a log scale to matter. */
  readonly log: number | null;
}

/**
 * Returns true when the column is the table's first column and every value is
 * different. Brackets there, such as 0-4, 5-9, and 10-14, name the rows in
 * order, the way years do. Shading them adds nothing. Brackets in other
 * columns, such as a median age of 35-39, are values.
 */
export const namesRows = (p: NumericProfile): boolean =>
  p.col === 0 && p.distinct === p.values.filter((v) => v !== null).length;

/**
 * Returns true when the values count the rows, up or down. Examples are 1, 2,
 * 3, or 51, 52, 53 on a second page, with ties such as 1, 1, 3. Such ranks
 * repeat the row order, so shading them adds nothing. Other ranks, such as
 * one outlet's ranking beside the table's own, are worth comparing.
 */
export const followsRows = (p: Pick<NumericProfile, "values">): boolean => {
  // Keep each value's row position. A blank cell is a tie written once (1, 2, "", 4).
  const rows = p.values.flatMap((v, i) => (v === null ? [] : [{ v, i }]));
  const counts = (dir: 1 | -1) =>
    rows.every(
      ({ v, i }, k) =>
        k === 0 || v === rows[k - 1]!.v || v === rows[k - 1]!.v + dir || v === rows[0]!.v + dir * (i - rows[0]!.i),
    );
  return counts(1) || counts(-1);
};

/** Returns true when the values span at least one order of magnitude, so a log scale could matter. */
export const logEligible = (p: NumericProfile): boolean => p.decades !== null && p.decades >= 1;

/**
 * Returns the role and polarity questions for numeric column `p`, and a log
 * question when `logEligible` is true. `k` is the column's index in the
 * table state's `columns`.
 */
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
      // Bins count as amounts, shaded by their midpoints, unless they name the rows.
      // Ranks count unless they follow the rows.
      measure:
        (role["measure"] ?? 0) + (namesRows(p) ? 0 : (role["bins"] ?? 0)) + (followsRows(p) ? 0 : (role["rank"] ?? 0)),
      role: roleAnswer?.type === "choice" ? roleAnswer.choice : "unknown",
      polarity: readPolarity(answers, id("polarity")),
      log: logEligible(p) ? noul(answers, id("log")) : null,
    };
  };
  return { questions, read };
};

// ── Categorical columns ─────────────────────────────────────────────────────

/** The answers about one categorical column. */
export interface CategoricalReading {
  /** P(the labels are ordered levels of one property). */
  readonly ordinal: number;
  /** The most likely relation, such as "ordered_levels" or "unordered_kinds". */
  readonly relation: string;
  readonly polarity: Record<Polarity, number>;
  /** P(labels[i] is a lower grade than labels[j]), for i < j. 0.5 when the pair was not asked. */
  readonly lower: (i: number, j: number) => number;
}

/**
 * Returns one Choice per ordered pair of labels that asks which label is the
 * lower grade. For more than three levels, pairwise questions did better
 * than asking for each label's position. The criteria fix the direction with
 * words such as smaller and cheaper. With "earlier" alone, the order flipped
 * on catalogs that list the flagship first. Each pair is asked in both
 * orders, and `read` averages the two. The average cancels a preference for
 * slot `a`.
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
 * Returns the state for one categorical column's request: the titles, the
 * column's labels, and the other headers. The full table is left out. With
 * it in the state, pairwise orders got worse, such as C < M < U < R.
 */
export const categoricalState = (ctx: TableContext, p: CategoricalProfile, siblings: readonly string[]) => ({
  page_title: ctx.page,
  table_title: ctx.table,
  column: describeColumn(p),
  // The other headers tell the model what the table is about. Headers such as Input and
  // Output raised P(ordered levels) for Lightweight, Versatile, Powerful from 0.67 to 0.85.
  other_columns: siblings,
});

/**
 * Returns the relation and polarity questions for categorical column `p`.
 * The pairwise order questions, n(n-1) for n labels, are in `pairQuestions`.
 * `judgeColumns` sends them in a second request, and only when `ordinalOf`
 * says the labels might be ordered.
 */
export const categoricalQuestions = (p: CategoricalProfile) => {
  const ref = `the column \`column\` ("${p.header}")`;
  const id = (q: string) => `c${p.col}.${q}`;
  const labels = p.levels.map((l) => p.display[l] ?? l);
  const pairs = pairQuestions(`c${p.col}`, ref, labels);
  const questions: Record<string, Question> = {
    // A Choice rather than a Noul. The named alternatives, such as statuses and
    // options, keep "GA / Preview" and "Default / Long context" from reading as ordered.
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
        scores_or_records: "They are game scores or win-loss records written as two numbers (35-10, 12-4).",
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
  return {
    questions,
    pairQuestions: pairs.questions,
    ordinalOf: (a: Answers) => probabilities(a, id("relation"))["ordered_levels"] ?? 0,
    read,
  };
};

// ── Aggregate rows ──────────────────────────────────────────────────────────

/**
 * Returns the rows to ask about as possible summary rows: the first two and
 * the last two. A table with fewer than five rows gets none. Rows such as
 * World, Total, League average, and Career sit at the top or the bottom.
 */
export const aggregateCandidates = (rowCount: number): number[] =>
  rowCount < 5 ? [] : [...new Set([0, 1, rowCount - 2, rowCount - 1])];

/** The fewest numeric columns whose sums must check out before code calls a row a total. */
const MIN_SUM_COLUMNS = 2;

/** A cell that names its row a total: "Total", "Totals", "Grand total", "Total votes". */
const TOTAL_LABEL = /^(?:grand\s+)?totals?\b/i;

/**
 * Returns the first or the last row when its numbers are the sums of the
 * other rows. A box score's team row often has no label that names it a
 * total, but its numbers do. A column counts when the row and at least two
 * other rows have values and the others do not sum to zero. At least
 * `MIN_SUM_COLUMNS` columns must match, and they must be at least two thirds
 * of the columns that count, so a jersey number or an average in one column
 * does not hide the total. A table of three or four rows, such as an
 * election result with two candidates and a total, gets no model question,
 * so there every column that counts must match. A row with a cell that says
 * it is a total ("Total") needs only one column, but every column that counts
 * must match: a worked bill has one cost column and a Total row under it.
 */
export const sumRows = (
  numeric: readonly NumericProfile[],
  rowCount: number,
  rows: readonly (readonly string[])[] = [],
): number[] =>
  (rowCount < 3 ? [] : [...new Set([0, rowCount - 1])]).filter((r) => {
    let matched = 0;
    let counted = 0;
    for (const p of numeric) {
      const total = p.values[r];
      const others = p.values.filter((v, i): v is number => i !== r && v !== null);
      if (total === null || total === undefined || others.length < 2) continue;
      const sum = others.reduce((a, b) => a + b, 0);
      if (sum === 0) continue;
      counted++;
      // Cells are rounded for display, so allow half a percent.
      if (Math.abs(total - sum) <= Math.max(1e-9, 0.005 * Math.abs(sum))) matched++;
    }
    if ((rows[r] ?? []).some((cell) => TOTAL_LABEL.test(cell.trim()))) return matched >= 1 && matched === counted;
    if (rowCount < 5) return matched >= MIN_SUM_COLUMNS && matched === counted;
    return matched >= MIN_SUM_COLUMNS && matched * 3 >= counted * 2;
  });

/**
 * Returns one Noul per candidate row that asks whether the row summarizes the
 * other rows. `read` returns the rows at or above `threshold`.
 */
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

/** One column in a share question. For an ordinal column, `examples` are its labels in order. */
export interface GroupMember {
  readonly table: string | null;
  readonly header: string;
  readonly unit: string | null;
  readonly examples: readonly string[];
}

/** Returns a Noul that asks whether columns from different tables can share one color scale. */
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
