/**
 * Service worker. Owns credentials and every call to the decision model; the
 * content script only ever sees judgments.
 */
import { Effect, Layer } from "effect";
import { DEFAULT_POLICY, judgePage } from "../decide/judge.ts";
import { AnswerCache, DecisionError, layerFromConfig, type DecisionResponse } from "../decide/model.ts";
import type { JudgeReply, PageConfig, ToContent, ToWorker } from "./messages.ts";
import {
  isPagePaused,
  loadSettings,
  providerConfig,
  saveSettings,
  setPagePaused,
  setSiteEnabledIn,
  siteEnabled,
} from "./settings.ts";

/** Versioned so a change in answer format never replays old entries. */
const CACHE_PREFIX = "answers:v2:";
const CACHE_INDEX = "answers:v2:index";
/**
 * Pages whose numbers change on every load add a new entry each time; keep the
 * newest. Sized to stay well inside storage.local's default 10 MB quota.
 */
const CACHE_MAX = 1500;
const CACHE_EVICT = 300;

/**
 * Raw answers persist across sessions, so unchanged tables cost nothing on a
 * second visit. Entries are re-validated on read (model.ts); writes are
 * best-effort, since a full or failing store must not fail a judgment.
 */
const ChromeAnswerCache = Layer.succeed(AnswerCache, {
  get: (key) =>
    Effect.promise(async () => {
      const k = CACHE_PREFIX + key;
      const hit = await chrome.storage.local.get(k).catch(() => ({}) as Record<string, unknown>);
      return hit[k] as DecisionResponse | undefined;
    }),
  set: (key, value) =>
    Effect.promise(async () => {
      try {
        const stored = await chrome.storage.local.get(CACHE_INDEX);
        const index = (stored[CACHE_INDEX] as string[] | undefined) ?? [];
        index.push(key);
        const evicted = index.length > CACHE_MAX ? index.splice(0, CACHE_EVICT) : [];
        await chrome.storage.local.set({ [CACHE_PREFIX + key]: value, [CACHE_INDEX]: index });
        if (evicted.length > 0) await chrome.storage.local.remove(evicted.map((k) => CACHE_PREFIX + k));
      } catch {
        // Best effort.
      }
    }),
});

/** After rate limiting or overload, stop sending for a while instead of retrying on every scroll. */
const COOL_DOWN_MS = 30_000;
let coolUntil = 0;

/** Bounds on what one page can ask for, whatever the content script sends. */
const MAX_TABLES = 200;
const MAX_ROWS = 10_000;

const judge = async (msg: Extract<ToWorker, { type: "judge" }>): Promise<JudgeReply> => {
  const settings = await loadSettings();
  const config = providerConfig(settings);
  if (config === null) {
    return { ok: false, reason: "missing_config", message: "Add an API key in the extension options." };
  }
  if (Date.now() < coolUntil) {
    return { ok: false, reason: "rate_limited", message: "Cooling down after rate limiting; try again shortly." };
  }
  const page = { ...msg.page, tables: msg.page.tables.slice(0, MAX_TABLES).map((t) => ({ ...t, rows: t.rows.slice(0, MAX_ROWS) })) };
  const program = judgePage(page, DEFAULT_POLICY, msg.orientations).pipe(
    Effect.provide(Layer.merge(layerFromConfig(config), ChromeAnswerCache)),
    Effect.map((judgment): JudgeReply => ({ ok: true, judgment, palette: settings.palette })),
    Effect.catchTag("DecisionError", (e: DecisionError) => {
      if (e.reason === "rate_limited" || e.reason === "overloaded") coolUntil = Date.now() + COOL_DOWN_MS;
      return Effect.succeed<JudgeReply>({ ok: false, reason: e.reason, message: e.message });
    }),
  );
  return Effect.runPromise(program);
};

chrome.runtime.onMessage.addListener((msg: ToWorker, sender, sendResponse) => {
  // Only this extension's own pages and content scripts.
  if (sender.id !== chrome.runtime.id) return false;
  if (msg.type === "pageConfig") {
    pageConfig(msg.url).then(sendResponse, () => sendResponse({ enabled: false } satisfies PageConfig));
    return true;
  }
  if (msg.type === "setPagePaused") {
    pausePage(msg.tabId, msg.url, msg.paused).then(() => sendResponse(true));
    return true;
  }
  if (msg.type === "setSiteEnabled") {
    enableSite(msg.tabId, msg.host, msg.enabled).then(() => sendResponse(true));
    return true;
  }
  if (sender.tab === undefined) return false;
  judge(msg).then(
    (reply) => {
      sendResponse(reply);
      const tabId = sender.tab?.id;
      if (tabId !== undefined && reply.ok) {
        const n = reply.judgment.tables.reduce((s, t) => s + t.encodings.length, 0);
        void chrome.action.setBadgeText({ tabId, text: n === 0 ? "" : String(n) });
        void chrome.action.setBadgeBackgroundColor({ tabId, color: "#5b4bc4" });
      }
    },
    (e: unknown) => sendResponse({ ok: false, reason: "internal", message: String(e) } satisfies JudgeReply),
  );
  return true;
});

// ── Turning it off ──────────────────────────────────────────────────────────

// Content scripts read the per-page pause list from session storage.
void chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" });

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
  const [settings, paused] = await Promise.all([loadSettings(), isPagePaused(url)]);
  return { enabled: siteEnabled(settings, host) && !paused };
};

const enableSite = async (tabId: number, host: string, enabled: boolean) => {
  await saveSettings(setSiteEnabledIn(await loadSettings(), host, enabled));
  await tell(tabId, enabled);
  if (!enabled) await chrome.action.setBadgeText({ tabId, text: "" });
};

/** Keyboard shortcut: flip the current page. */
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "toggle-page" || tab?.id === undefined || tab.url === undefined) return;
  await pausePage(tab.id, tab.url, !(await isPagePaused(tab.url)));
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === "install" && providerConfig(await loadSettings()) === null) {
    await chrome.runtime.openOptionsPage();
  }
});

/** Repaint open tabs when the palette or provider changes. */
chrome.storage.onChanged.addListener(async (changes) => {
  if (changes["settings"] === undefined) return;
  for (const tab of await chrome.tabs.query({})) {
    if (tab.id !== undefined) {
      await chrome.tabs.sendMessage(tab.id, { type: "repaint" } satisfies ToContent).catch(() => undefined);
    }
  }
});
