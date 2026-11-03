/**
 * Detects a table that shows one page of a longer set. Sorting or copying such
 * a table misleads, because the rows on screen are not the whole table. The
 * signals are conservative: pagination controls near the table, or row-count
 * text such as "1–25 of 1,300".
 */

/** "1–25 of 1,300", "Showing 1 to 25 of 1300 entries". */
const RANGE_OF_RE = /\b\d[\d,.]*\s*(?:[–—-]|to)\s*\d[\d,.]*\s+(?:of|von|sur|de|di)\s+\d[\d,.]*/i;

const PAGINATION_CONTROL = [
  'a[rel="next"]',
  'link[rel="next"]',
  '[aria-label*="next page" i]',
  '[aria-label*="pagination" i]',
  'nav[aria-label*="pag" i]',
  '[class*="pagination" i]',
  '[class*="pager" i]',
  '[data-testid*="pagination" i]',
].join(", ");

/** How many ancestors of the table are searched for pagination controls. */
const ANCESTOR_LEVELS = 3;

/**
 * True when the table sits next to pagination. The search covers the table's
 * container (a few ancestors and their direct children), not the whole page,
 * so a site-wide pager in the footer does not mark every table.
 */
export const isPaginated = (table: HTMLTableElement): boolean => {
  let scope: Element = table;
  for (let i = 0; i < ANCESTOR_LEVELS; i++) {
    const parent = scope.parentElement;
    if (parent === null || parent === document.body || parent === document.documentElement) break;
    scope = parent;
  }
  if (scope.querySelector(PAGINATION_CONTROL) !== null) return true;
  // Row-count text sits in small captions or toolbars near the table, so only
  // short texts count. Matching the scope's full text would catch article prose.
  for (const el of scope.querySelectorAll("caption, p, span, div, summary, output")) {
    if (el.closest("table") !== null && el.closest("table") !== table) continue;
    const text = el.childElementCount === 0 ? (el.textContent ?? "") : "";
    if (text.length <= 80 && RANGE_OF_RE.test(text)) return true;
  }
  return false;
};
