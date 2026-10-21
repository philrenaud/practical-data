/**
 * Limitations that show only on the live pages. The page copies that the
 * checks use cannot show them. Last checked against the live pages in October 2026.
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

/** Notes for the sites page, keyed by fixture slug. */
export const SITE_NOTES: Readonly<Record<string, string>> = {
  "mtggoldfish-modern-price-index":
    "The live page now builds its price lists from div elements, not tables. The extension does not shade them.",
};
