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
