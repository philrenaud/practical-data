/** Extension settings, stored in chrome.storage.local. */
import { DEFAULT_PALETTE, isPaletteId, type PaletteId as Palette } from "../core/palettes.ts";
import type { ProviderConfig } from "../decide/model.ts";

export interface Settings {
  readonly provider: "jev" | "clef";
  readonly typesafeApiKey: string;
  readonly cloudflareAccountId: string;
  readonly cloudflareApiToken: string;
  readonly clefModel: "clef" | "clef-flash";
  readonly palette: Palette;
  /** "everywhere": on unless a site is turned off. "chosen": off unless a site is turned on. */
  readonly mode: "everywhere" | "chosen";
  /** Hostnames turned off (in "everywhere" mode). */
  readonly disabledHosts: readonly string[];
  /** Hostnames turned on (in "chosen" mode). */
  readonly enabledHosts: readonly string[];
}

export const DEFAULT_SETTINGS: Settings = {
  provider: "jev",
  typesafeApiKey: "",
  cloudflareAccountId: "",
  cloudflareApiToken: "",
  clefModel: "clef",
  palette: DEFAULT_PALETTE,
  mode: "everywhere",
  disabledHosts: [],
  enabledHosts: [],
};

export const loadSettings = async (): Promise<Settings> => {
  const stored = await chrome.storage.local.get("settings");
  const merged = { ...DEFAULT_SETTINGS, ...(stored["settings"] as Partial<Settings> | undefined) };
  // Palettes before October 2026 were "classic" | "colorblind"; unknown ids fall back to the default.
  return { ...merged, palette: isPaletteId(merged.palette) ? merged.palette : DEFAULT_PALETTE };
};

export const saveSettings = (s: Settings) => chrome.storage.local.set({ settings: s });

export const siteEnabled = (s: Settings, host: string): boolean =>
  s.mode === "everywhere" ? !s.disabledHosts.includes(host) : s.enabledHosts.includes(host);

export const setSiteEnabledIn = (s: Settings, host: string, enabled: boolean): Settings => {
  const without = (xs: readonly string[]) => xs.filter((h) => h !== host);
  return s.mode === "everywhere"
    ? { ...s, disabledHosts: enabled ? without(s.disabledHosts) : [...without(s.disabledHosts), host] }
    : { ...s, enabledHosts: enabled ? [...without(s.enabledHosts), host] : without(s.enabledHosts) };
};

/** Null when the chosen provider is missing credentials. */
export const providerConfig = (s: Settings): ProviderConfig | null => {
  if (s.provider === "jev") return s.typesafeApiKey === "" ? null : { provider: "jev", apiKey: s.typesafeApiKey };
  if (s.cloudflareAccountId === "" || s.cloudflareApiToken === "") return null;
  return { provider: "clef", accountId: s.cloudflareAccountId, apiToken: s.cloudflareApiToken, model: s.clefModel };
};

// ── Per-page pause (session) ────────────────────────────────────────────────

const PAUSED = "pausedPages";

/** A page is its URL without the fragment: in-page anchors are the same page. */
export const pageKey = (url: string): string => url.split("#")[0] ?? url;

export const isPagePaused = async (url: string): Promise<boolean> => {
  const stored = await chrome.storage.session.get(PAUSED);
  return ((stored[PAUSED] as string[] | undefined) ?? []).includes(pageKey(url));
};

export const setPagePaused = async (url: string, paused: boolean): Promise<void> => {
  const stored = await chrome.storage.session.get(PAUSED);
  const pages = new Set((stored[PAUSED] as string[] | undefined) ?? []);
  if (paused) pages.add(pageKey(url));
  else pages.delete(pageKey(url));
  await chrome.storage.session.set({ [PAUSED]: [...pages] });
};

// ── Per-table choices (session) ─────────────────────────────────────────────

/** Reader's choices for one table: which way to compare, and whether to shade it at all. */
export interface TableChoice {
  readonly orientation?: "columns" | "rows";
  readonly hidden?: boolean;
}

const tablesKey = (url: string) => `tables:${pageKey(url)}`;

export const loadTableChoices = async (url: string): Promise<Record<string, TableChoice>> => {
  const stored = await chrome.storage.session.get(tablesKey(url));
  return (stored[tablesKey(url)] as Record<string, TableChoice> | undefined) ?? {};
};

export const saveTableChoices = (url: string, choices: Record<string, TableChoice>) =>
  chrome.storage.session.set({ [tablesKey(url)]: choices });
