/**
 * Limitations seen on live pages rather than in a check: the copies the
 * checks use can't show them. Checked against the live pages, October 2026.
 */

export interface SiteLimitation {
  readonly title: string;
  readonly body: string;
  readonly examples: readonly { readonly label: string; readonly url: string }[];
}

export const SITE_LIMITATIONS: readonly SiteLimitation[] = [
  {
    title: "Only HTML tables are read.",
    body: "Some pages build a grid from div elements. It looks like a table, but it is not one, and the extension does not shade it. MTGGoldfish now shows its price lists this way. Our copy of the page has tables, thus its checks pass; the live page has no table to shade.",
    examples: [{ label: "MTGGoldfish: Modern Staples", url: "https://www.mtggoldfish.com/index/modern" }],
  },
];

/** What a reader should know before opening a test site with the extension, by fixture slug. */
export const SITE_NOTES: Readonly<Record<string, string>> = {
  "mtggoldfish-modern-price-index":
    "The live page now builds its price lists from div elements, not tables. The extension does not shade them.",
};
