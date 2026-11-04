/**
 * Serializes a table's text grid for the clipboard. The fields are the page's
 * own cell text, as extracted. No parsed values stand in for the text: the
 * parse can be wrong, the text never is.
 */

export type CopyFormat = "csv" | "markdown";

/** RFC 4180: a field with a quote, comma, or line break is quoted, and quotes double. */
const csvField = (text: string): string => (/[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text);

export const toCSV = (headers: readonly string[], rows: readonly (readonly string[])[]): string =>
  [headers, ...rows].map((r) => r.map(csvField).join(",")).join("\r\n");

/** Pipes would end the cell, and a line break would end the row. */
const markdownCell = (text: string): string => text.replaceAll(/\s*[\r\n]+\s*/g, " ").replaceAll("|", "\\|");

export const toMarkdown = (headers: readonly string[], rows: readonly (readonly string[])[]): string => {
  const line = (cells: readonly string[]): string => `| ${cells.map(markdownCell).join(" | ")} |`;
  return [line(headers), `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map(line)].join("\n");
};
