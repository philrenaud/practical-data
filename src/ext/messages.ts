/** Message types for the content script, the popup, and the service worker. */
import type { PageJudgment, PageSnapshot } from "../core/types.ts";
import type { Orientation } from "../core/orient.ts";
import type { Palette } from "../core/scale.ts";
import type { TableChoice } from "./settings.ts";

/** Messages to the service worker. */
export type ToWorker =
  /**
   * Asks whether the extension is on for this page, and for the page's saved
   * table choices. Content scripts can't read extension storage, so only the
   * worker reads it.
   */
  | { readonly type: "pageConfig"; readonly url: string }
  /** Saves the page's table choices until the browser session ends. */
  | { readonly type: "saveTableChoices"; readonly url: string; readonly choices: Readonly<Record<string, TableChoice>> }
  | {
      readonly type: "judge";
      readonly page: PageSnapshot;
      /** Orientations the user chose, by table id. The model is not asked about these tables. */
      readonly orientations: Readonly<Record<string, Orientation>>;
    }
  /** Pauses or resumes one page until the browser session ends. Popup only. */
  | { readonly type: "setPagePaused"; readonly tabId: number; readonly url: string; readonly paused: boolean }
  /** Turns a host on or off and saves it in the settings. Popup only. */
  | { readonly type: "setSiteEnabled"; readonly tabId: number; readonly host: string; readonly enabled: boolean };

/** The worker's reply to `judge`. */
export type JudgeReply =
  | { readonly ok: true; readonly judgment: PageJudgment; readonly palette: Palette }
  | { readonly ok: false; readonly reason: string; readonly message: string };

/** Messages to the content script. Only the worker and the popup send them. */
export type ToContent =
  { readonly type: "toggle"; readonly enabled: boolean } | { readonly type: "repaint" } | { readonly type: "state" };

/** The content script's reply to `state`, for the popup. */
export interface PageState {
  /** The page's URL. The popup can't always read tab URLs, because the manifest has no "tabs" permission. */
  readonly url: string;
  readonly enabled: boolean;
  /** The value of `data-pd-status`: "done", "idle", "none", "off", "working", or "error:<reason>". */
  readonly status: string;
  readonly tables: number;
  readonly columns: number;
}

/** The worker's reply to `pageConfig`. */
export interface PageConfig {
  readonly enabled: boolean;
  /** The saved table choices for the page, keyed by table fingerprint. */
  readonly choices: Readonly<Record<string, TableChoice>>;
}
