/** Messages between the content script, the popup, and the service worker. */
import type { PageJudgment, PageSnapshot } from "../core/types.ts";
import type { Orientation } from "../core/orient.ts";
import type { Palette } from "../core/scale.ts";

export type ToWorker =
  /** Content script start-up: is this page on? (Content scripts never read settings, which hold keys.) */
  | { readonly type: "pageConfig"; readonly url: string }
  | {
      readonly type: "judge";
      readonly page: PageSnapshot;
      /** Tables whose orientation the reader picked; the model isn't asked for these. */
      readonly orientations: Readonly<Record<string, Orientation>>;
    }
  /** Off for this page until the browser session ends. */
  | { readonly type: "setPagePaused"; readonly tabId: number; readonly url: string; readonly paused: boolean }
  /** Off for every page on a host, persistently. */
  | { readonly type: "setSiteEnabled"; readonly tabId: number; readonly host: string; readonly enabled: boolean };

export type JudgeReply =
  | { readonly ok: true; readonly judgment: PageJudgment; readonly palette: Palette }
  | { readonly ok: false; readonly reason: string; readonly message: string };

export type ToContent =
  | { readonly type: "toggle"; readonly enabled: boolean }
  | { readonly type: "repaint" }
  | { readonly type: "state" };

/** Reply to `state`: what the popup shows. */
export interface PageState {
  /** The page's own URL; the popup can't read tab URLs without the "tabs" permission. */
  readonly url: string;
  readonly enabled: boolean;
  /** Content status: "done", "idle", "none", "off", "working", "error:<reason>". */
  readonly status: string;
  readonly tables: number;
  readonly columns: number;
}

export interface PageConfig {
  readonly enabled: boolean;
}
