/** Toolbar popup: what's colored here, and switches for this page and this site. */
import type { PageState, ToContent, ToWorker } from "./messages.ts";
import { isPagePaused, loadSettings, siteEnabled } from "./settings.ts";

const summary = document.querySelector<HTMLParagraphElement>("#summary")!;
const page = document.querySelector<HTMLInputElement>("#page")!;
const site = document.querySelector<HTMLInputElement>("#site")!;

// `?tab=<id>` targets a specific tab; the e2e harness opens the popup as a page.
const forced = Number(new URLSearchParams(location.search).get("tab"));
const [tab] = Number.isInteger(forced) && forced > 0
  ? [await chrome.tabs.get(forced)]
  : await chrome.tabs.query({ active: true, currentWindow: true });

const query = async (): Promise<PageState | undefined> =>
  tab?.id === undefined
    ? undefined
    : ((await chrome.tabs.sendMessage(tab.id, { type: "state" } satisfies ToContent).catch(() => undefined)) as PageState | undefined);

const first = await query();
const url = first?.url ?? tab?.url ?? "";
const host = /^https?:|^file:/.test(url) ? new URL(url).hostname || "local files" : "";

const describe = (s: PageState | undefined, paused: boolean, siteOff: boolean): string => {
  if (siteOff) return `Off on ${host}.`;
  if (paused) return "Off on this page.";
  if (s === undefined) return "Not available on this page.";
  if (s.status === "working") return "Reading tables…";
  if (s.status.startsWith("error:")) return s.status === "error:missing_config" ? "Add an API key in Options." : "Couldn't reach the model.";
  if (s.columns === 0) return s.status === "none" ? "No tables on this page." : "No comparable columns yet.";
  return `${s.columns} column${s.columns === 1 ? "" : "s"} shaded in ${s.tables} table${s.tables === 1 ? "" : "s"}.`;
};

const refresh = async () => {
  const [settings, paused] = await Promise.all([loadSettings(), isPagePaused(url)]);
  const siteOff = !siteEnabled(settings, host);
  const state = await query();
  site.checked = !siteOff;
  page.checked = !paused && !siteOff;
  page.disabled = siteOff || state === undefined;
  site.disabled = host === "";
  document.querySelector("#site-label")!.textContent = host === "" ? "Shade tables on this site" : `Shade tables on ${host}`;
  summary.textContent = describe(state, paused, siteOff);
};

const send = (msg: ToWorker) => chrome.runtime.sendMessage(msg);

page.addEventListener("change", async () => {
  if (tab?.id !== undefined) await send({ type: "setPagePaused", tabId: tab.id, url, paused: !page.checked });
  await refresh();
});
site.addEventListener("change", async () => {
  if (tab?.id !== undefined) await send({ type: "setSiteEnabled", tabId: tab.id, host, enabled: site.checked });
  await refresh();
});
document.querySelector("#privacy")!.addEventListener("click", (ev) => {
  ev.preventDefault();
  void chrome.runtime.openOptionsPage();
});
document.querySelector("#options")!.addEventListener("click", (ev) => {
  ev.preventDefault();
  void chrome.runtime.openOptionsPage();
});
const commands = await chrome.commands.getAll();
const shortcut = commands.find((c) => c.name === "toggle-page")?.shortcut;
document.querySelector("#shortcut")!.textContent = shortcut ? `${shortcut} toggles this page` : "";

document.querySelector("#build")!.textContent = `Build ${chrome.runtime.getManifest().version_name ?? chrome.runtime.getManifest().version}`;
await refresh();
// Flush styles so the initial state is applied without animating, then enable transitions.
void document.body.offsetHeight;
document.body.classList.add("ready");
// The page may still be reading tables; refresh once more shortly after opening.
setTimeout(() => void refresh(), 1200);
