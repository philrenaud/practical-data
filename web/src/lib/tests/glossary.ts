/**
 * Plain definitions of every answer the model can give, by question kind.
 * The text sent to the model is longer (src/decide/questions.ts); these are
 * for readers, in Simplified Technical English.
 */

export interface GlossaryEntry {
  /** Question kind, as on the check pages: ids with numbers replaced by #. */
  readonly kinds: readonly string[];
  readonly question: string;
  readonly answers: Readonly<Record<string, string>>;
}

export const GLOSSARY: readonly GlossaryEntry[] = [
  {
    kinds: ["n#.role"],
    question: "What kind of numbers are in the column?",
    answers: {
      measure: "An amount that you can compare between rows: a price, a count, a rate, a size, or a duration.",
      identifier: "A number that is a name: an ID, a code, a version, or a jersey number.",
      time: "A year, a season, a date, an age, or a time of day.",
      rank: "A position in a list: 1st, 2nd, 3rd.",
      bins: "A bracket of values, such as ages 20–25 or 65+.",
      record: "Two counts together, such as a win-loss record (12-4) or a score (35-10).",
      threshold: "A limit that tells which rule or price applies, such as ≤ 272K tokens.",
    },
  },
  {
    kinds: ["c#.relation"],
    question: "How do the labels in the column relate to each other?",
    answers: {
      ordered_levels: "Grades in a fixed order: sizes, tiers, severities, ratings.",
      unordered_kinds: "Names, kinds, places, or groups with no order.",
      workflow_states: "Steps in a process: open, in progress, done.",
      options: "Alternatives. No option is more of anything: default, custom.",
      scores_or_records: "Scores or records written as two numbers: 35-10, 12-4.",
      names_or_versions: "Names or versions of products or models: iPhone 14, iPhone 15.",
    },
  },
  {
    kinds: ["n#.polarity", "c#.polarity"],
    question: "Is a higher value better or worse?",
    answers: {
      higher_is_better: "A reader prefers larger values: home runs, battery life, revenue.",
      lower_is_better: "A reader prefers smaller values: price, time taken, errors.",
      neutral: "No direction is better: height, population, year.",
    },
  },
  {
    kinds: ["n#.log"],
    question: "Are ratios more important than differences?",
    answers: {
      yes: "Yes. Use a log scale.",
      no: "No. Use a linear scale.",
    },
  },
  {
    kinds: ["c#.lt#_#", "g#.lt#_#"],
    question: "Which of two labels is the lower grade?",
    answers: {
      a: "The first label is lower.",
      b: "The second label is lower.",
    },
  },
  {
    kinds: ["row#.aggregate"],
    question: "Is this row a total?",
    answers: {
      yes: "The row is a total, an average, or another summary of the other rows.",
      no: "The row is one entry.",
    },
  },
  {
    kinds: ["g#.share"],
    question: "Do these columns in different tables measure the same quantity?",
    answers: {
      yes: "Yes, in the same units. They get one scale.",
      no: "No. Each table keeps its own scale.",
    },
  },
  {
    kinds: ["table.orientation"],
    question: "Do you compare values down each column or across each row?",
    answers: {
      columns: "Down each column. Each column is one measure.",
      rows: "Across each row. Each row is one measure.",
    },
  },
];

/** The glossary entry for a question id ("n3.role" → the n#.role entry). */
export const glossaryFor = (id: string): GlossaryEntry | undefined => {
  const kind = id.replace(/\d+/g, "#");
  return GLOSSARY.find((g) => g.kinds.includes(kind));
};

/** An answer key as words: "higher_is_better" → "higher is better". */
export const answerName = (key: string): string => key.replaceAll("_", " ");

/** The anchor of one answer on the glossary page. */
export const answerAnchor = (entry: GlossaryEntry, key: string): string => `${entry.kinds[0]!.replace(/[#.]/g, "")}-${key}`;

/** The table description sent with each request, field by field (src/decide/questions.ts, tableState). */
export const DESCRIPTION_FIELDS: readonly { readonly field: string; readonly text: string }[] = [
  { field: "page_title", text: "The title of the page." },
  { field: "table_title", text: "The caption of the table, or the nearest heading above it." },
  { field: "rows_are", text: "The first column where each value is different, with examples. It tells what each row is: a player, a model, a country." },
  { field: "columns", text: "One entry for each column that the model is asked about. Code does not send text columns." },
  { field: "header", text: "The column header, as on the page." },
  { field: "kind", text: "number or label. Code decides this from the cells." },
  { field: "unit", text: "The unit that code found in the cells, such as $, %, or km. Not sent when there is no unit." },
  { field: "examples", text: "Five values from the column: the smallest, the largest, and three between them." },
  { field: "values", text: "For a label column: each different label, in the order that it first appears." },
  { field: "spread", text: "How wide the range of values is, in words. Code calculates it from the numbers." },
  { field: "notes", text: "Hints about the form of the values. Code adds a note only when it applies." },
];

/** Every spread code can send, and when. */
export const SPREADS: readonly { readonly text: string; readonly when: string }[] = [
  { text: "values are within a factor of 2 of each other", when: "The largest value is less than 2 times the smallest." },
  { text: "largest value is under 10 times the smallest", when: "From 2 times to 10 times." },
  { text: "values span about N orders of magnitude (largest is ~X times the smallest)", when: "10 times or more. Only then does the model get the log-scale question." },
  { text: "includes zero or negative values", when: "A ratio is not possible, thus code does not calculate one." },
];

/** Every note code can send, and when. */
export const NOTES: readonly { readonly text: string; readonly when: string }[] = [
  { text: "the values are exactly 1, 2, 3, … in row order", when: "The column counts the rows. It is usually a rank or a row number." },
  { text: "every value is a whole number between 1800 and 2100", when: "The values can be years." },
  { text: "the values are spans of calendar years, such as 1950-1954", when: "Most values are two years joined by a dash." },
  { text: "most values are written as bounds with ≤, <, ≥, >, or + rather than exact amounts", when: "Half of the values or more are limits, not exact amounts." },
  { text: "most values are written as two numbers joined by a dash, such as 20-25", when: "Half of the values or more are ranges. Code puts a range at its midpoint." },
  { text: "values are written like clock readings (such as 2:41); they could be durations or times of day", when: "Half of the values or more look like clock times." },
];
