/**
 * The free allowance as the reader sees it: what's left, when it resets, and
 * the wording for both. Pure, so the popup and tests share it.
 *
 * The endpoint counts model requests; readers think in pages. The eval pages
 * take a median of 12 requests each, so counts are shown as pages at that
 * rate, rounded and labelled "about".
 */
import type { Allowance } from "../decide/model.ts";

/** Median model requests per page across the eval pages. */
export const REQUESTS_PER_PAGE = 12;
/** Below this share of the day's allowance, the popup says how much is left. */
const LOW_SHARE = 0.2;

/** The last allowance the endpoint reported, and the UTC day it applies to. */
export interface StoredAllowance extends Allowance {
  readonly day: string;
}

export const utcDay = (now: Date): string => now.toISOString().slice(0, 10);

/** Next UTC midnight, in the reader's own time: "8:00 PM". */
export const resetTime = (now: Date, locale?: string): string => {
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return reset.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
};

/**
 * Keeps the lowest count reported today. Responses to one page's requests
 * arrive out of order, so a later, higher count is stale; a new day starts over.
 */
export const mergeAllowance = (stored: StoredAllowance | undefined, reported: Allowance, now: Date): StoredAllowance => {
  const day = utcDay(now);
  if (stored === undefined || stored.day !== day || stored.limit !== reported.limit) return { ...reported, day };
  return { ...reported, remaining: Math.min(stored.remaining, reported.remaining), day };
};

/** The popup's message when a page couldn't be shaded for lack of allowance. */
export const quotaMessage = (reason: "quota" | "quota_everyone", now: Date, locale?: string): string =>
  reason === "quota"
    ? `You've used today's free allowance. It resets at ${resetTime(now, locale)}; add your own key in Options for unlimited use.`
    : `Today's free allowance is used up for everyone. It resets at ${resetTime(now, locale)}; add your own key in Options for unlimited use.`;

/** A note when little of today's allowance is left; null otherwise, or when it's from an earlier day. */
export const lowAllowanceNote = (stored: StoredAllowance | undefined, now: Date): string | null => {
  if (stored === undefined || stored.day !== utcDay(now)) return null;
  if (stored.remaining <= 0 || stored.remaining / stored.limit >= LOW_SHARE) return null;
  const pages = Math.round(stored.remaining / REQUESTS_PER_PAGE);
  const amount = pages <= 1 ? "About a page" : `About ${pages} pages`;
  return `${amount} of free use left today. Add your own key in Options for unlimited use.`;
};
