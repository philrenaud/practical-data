/**
 * The service worker. It holds the credentials and makes every call to the
 * decision model. The content script receives only judgments.
 */
import { Effect, Layer } from "effect";
import { DEFAULT_POLICY, judgePage } from "../decide/judge.ts";
import { AnswerCache, DecisionError, layerFromConfig, type Allowance } from "../decide/model.ts";
import { mergeAllowance, type StoredAllowance } from "./allowance.ts";
import { answerCache } from "./cache.ts";
import type { JudgeReply, PageConfig, ToContent, ToWorker } from "./messages.ts";
import {
  getInstallId,
  isPagePaused,
  loadSettings,
  providerConfig,
  saveSettings,
  setPagePaused,
  setSiteEnabledIn,
  siteEnabled,
} from "./settings.ts";

/**
 * storage.local holds API keys. Chrome opens it to content scripts by default,
 * and content.ts never reads it, so the worker closes it to them.
 */
void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => undefined);

/**
 * Content scripts read and write per-table choices in storage.session. Chrome
 * denies them access until this call completes, so pageConfig waits for it.
 */
const sessionShared = chrome.storage.session
  .setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" })
  .catch(() => undefined);

const ChromeAnswerCache = Layer.succeed(AnswerCache, answerCache(chrome.storage.local));

/** After rate limiting or overload, the worker stops sending for a while instead of retrying on every scroll. */
const COOL_DOWN_MS = 30_000;
/** A spent daily allowance stays spent until the UTC day ends, so the worker waits longer. */
const QUOTA_COOL_DOWN_MS = 15 * 60_000;
let coolUntil = 0;
let coolReason = "";

/** Writes are chained so that a late, higher count can't overwrite a lower one. */
let allowanceWrites = Promise.resolve();
const recordAllowance = (reported: Allowance) => {
  allowanceWrites = allowanceWrites.then(async () => {
    try {
      const { allowance } = (await chrome.storage.local.get("allowance")) as { allowance?: StoredAllowance };
      await chrome.storage.local.set({ allowance: mergeAllowance(allowance, reported, new Date()) });
    } catch {
      // Best effort. Only the popup's low-allowance note reads this value.
    }
  });
};

const isQuota = (reason: string) => reason === "quota" || reason === "quota_everyone";

/** Limits on one judge request, whatever the content script sends. */
const MAX_TABLES = 200;
const MAX_ROWS = 10_000;

const judge = async (msg: Extract<ToWorker, { type: "judge" }>): Promise<JudgeReply> => {
  const settings = await loadSettings();
  const base = providerConfig(settings, await getInstallId());
  const config = base?.provider === "hosted" ? { ...base, onAllowance: recordAllowance } : base;
  if (config === null) {
    return { ok: false, reason: "missing_config", message: "Add an API key in the extension options." };
  }
  if (Date.now() < coolUntil) {
    return isQuota(coolReason)
      ? { ok: false, reason: coolReason, message: "Today's free allowance is used up." }
      : { ok: false, reason: "rate_limited", message: "Cooling down after rate limiting; try again shortly." };
  }
  const page = {
    ...msg.page,
    tables: msg.page.tables.slice(0, MAX_TABLES).map((t) => ({ ...t, rows: t.rows.slice(0, MAX_ROWS) })),
  };
  const program = judgePage(page, DEFAULT_POLICY, msg.orientations).pipe(
    Effect.provide(Layer.merge(layerFromConfig(config), ChromeAnswerCache)),
    Effect.map((judgment): JudgeReply => ({ ok: true, judgment, palette: settings.palette })),
    Effect.catchTag("DecisionError", (e: DecisionError) => {
      if (e.reason === "rate_limited" || e.reason === "overloaded" || isQuota(e.reason)) {
        coolUntil = Date.now() + (isQuota(e.reason) ? QUOTA_COOL_DOWN_MS : COOL_DOWN_MS);
        coolReason = e.reason;
      }
      return Effect.succeed<JudgeReply>({ ok: false, reason: e.reason, message: e.message });
    }),
  );
  return Effect.runPromise(program);
};

chrome.runtime.onMessage.addListener((msg: ToWorker, sender, sendResponse) => {
  // Accept only this extension's pages and content scripts.
  if (sender.id !== chrome.runtime.id) return false;
  if (msg.type === "pageConfig") {
    pageConfig(msg.url).then(sendResponse, () => sendResponse({ enabled: false } satisfies PageConfig));
    return true;
  }
  // Only the popup sends the switches. A content script runs inside a web page, so the worker ignores its switches.
  const fromExtensionPage = sender.url?.startsWith(chrome.runtime.getURL("")) === true;
  if (msg.type === "setPagePaused") {
    if (!fromExtensionPage) return false;
    pausePage(msg.tabId, msg.url, msg.paused).then(() => sendResponse(true));
    return true;
  }
  if (msg.type === "setSiteEnabled") {
    if (!fromExtensionPage) return false;
    enableSite(msg.tabId, msg.host, msg.enabled).then(() => sendResponse(true));
    return true;
  }
  if (msg.type !== "judge" || sender.tab === undefined) return false;
  judge(msg).then(
    (reply) => {
      sendResponse(reply);
      const tabId = sender.tab?.id;
      if (tabId !== undefined && reply.ok) {
        const n = reply.judgment.tables.reduce((s, t) => s + t.encodings.length, 0);
        void chrome.action.setBadgeText({ tabId, text: n === 0 ? "" : String(n) });
        void chrome.action.setBadgeBackgroundColor({ tabId, color: "#5b4bc4" });
      } else if (tabId !== undefined && !reply.ok && isQuota(reply.reason)) {
        // The page stays plain when the free allowance is spent, so the toolbar badge shows it.
        void chrome.action.setBadgeText({ tabId, text: "!" });
        void chrome.action.setBadgeBackgroundColor({ tabId, color: "#c2410c" });
      }
    },
    (e: unknown) => sendResponse({ ok: false, reason: "internal", message: String(e) } satisfies JudgeReply),
  );
  return true;
});

// ── Page and site switches ──────────────────────────────────────────────────

const tell = (tabId: number, enabled: boolean) =>
  chrome.tabs.sendMessage(tabId, { type: "toggle", enabled } satisfies ToContent).catch(() => undefined);

const pausePage = async (tabId: number, url: string, paused: boolean) => {
  await setPagePaused(url, paused);
  const siteOff = !siteEnabled(await loadSettings(), new URL(url).hostname);
  await tell(tabId, !paused && !siteOff);
  if (paused) await chrome.action.setBadgeText({ tabId, text: "" });
};

const pageConfig = async (url: string): Promise<PageConfig> => {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return { enabled: false };
  }
  const [settings, paused] = await Promise.all([loadSettings(), isPagePaused(url), sessionShared]);
  return { enabled: siteEnabled(settings, host) && !paused };
};

const enableSite = async (tabId: number, host: string, enabled: boolean) => {
  await saveSettings(setSiteEnabledIn(await loadSettings(), host, enabled));
  await tell(tabId, enabled);
  if (!enabled) await chrome.action.setBadgeText({ tabId, text: "" });
};

/** The keyboard shortcut pauses or resumes the current page. */
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "toggle-page" || tab?.id === undefined || tab.url === undefined) return;
  await pausePage(tab.id, tab.url, !(await isPagePaused(tab.url)));
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === "install" && providerConfig(await loadSettings(), await getInstallId()) === null) {
    await chrome.runtime.openOptionsPage();
  }
});

/** Repaints open tabs when the settings change. */
chrome.storage.onChanged.addListener(async (changes) => {
  if (changes["settings"] === undefined) return;
  // A new key or provider has its own limits, so the cool-down ends.
  coolUntil = 0;
  for (const tab of await chrome.tabs.query({})) {
    if (tab.id !== undefined) {
      await chrome.tabs.sendMessage(tab.id, { type: "repaint" } satisfies ToContent).catch(() => undefined);
    }
  }
});
