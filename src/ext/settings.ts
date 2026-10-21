/**
 * Extension settings in chrome.storage.local, and per-page state in
 * chrome.storage.session.
 */
import { DEFAULT_PALETTE, isPaletteId, type PaletteId as Palette } from "../core/palettes.ts";
import type { ProviderConfig } from "../decide/model.ts";

/** The user's settings, stored under the `settings` key. */
export interface Settings {
  /** "hosted" is Jev through api.practicaldata.dev and needs no key. "jev" and "clef" use the user's own credentials. */
  readonly provider: "hosted" | "jev" | "clef";
  readonly typesafeApiKey: string;
  readonly cloudflareAccountId: string;
  readonly cloudflareApiToken: string;
  readonly clefModel: "clef" | "clef-flash";
  readonly palette: Palette;
  /**
   * In "everywhere" mode, a site is on unless the user turns it off. A private host (`isPrivateHost`)
   * is off until the user turns it on. In "chosen" mode, every site is off until the user turns it on.
   */
  readonly mode: "everywhere" | "chosen";
  /** Hostnames turned off in "everywhere" mode. */
  readonly disabledHosts: readonly string[];
  /** Hostnames turned on in "chosen" mode, and private hosts turned on in "everywhere" mode. */
  readonly enabledHosts: readonly string[];
}

export const DEFAULT_SETTINGS: Settings = {
  provider: "hosted",
  typesafeApiKey: "",
  cloudflareAccountId: "",
  cloudflareApiToken: "",
  clefModel: "clef",
  palette: DEFAULT_PALETTE,
  mode: "everywhere",
  disabledHosts: [],
  enabledHosts: [],
};

/** Returns the stored settings, with defaults for missing fields. */
export const loadSettings = async (): Promise<Settings> => {
  const stored = await chrome.storage.local.get("settings");
  const merged = { ...DEFAULT_SETTINGS, ...(stored["settings"] as Partial<Settings> | undefined) };
  // Palettes before October 2026 were "classic" | "colorblind"; unknown ids fall back to the default.
  return { ...merged, palette: isPaletteId(merged.palette) ? merged.palette : DEFAULT_PALETTE };
};

export const saveSettings = (s: Settings) => chrome.storage.local.set({ settings: s });

/**
 * Suffixes of names that only resolve on a local network:
 * .local (mDNS, RFC 6762), .home.arpa (RFC 8375), .internal (reserved by
 * ICANN in 2024 for private use), and .lan and .corp, which many routers and
 * companies use without a standard.
 */
const PRIVATE_SUFFIXES = [".localhost", ".local", ".home.arpa", ".internal", ".lan", ".corp"];

/** IPv4 ranges that are not on the public internet, as [first octet, second octet low, second octet high]. */
const PRIVATE_IPV4: readonly (readonly [number, number, number])[] = [
  [10, 0, 255],
  [127, 0, 255],
  [169, 254, 254],
  [172, 16, 31],
  [192, 168, 168],
  [100, 64, 127], // Carrier-grade NAT, which Tailscale also uses.
];

/**
 * Returns true if `host` is on a local or private network: localhost, a
 * name with no dot, a private suffix, or a private IP address. Pages on such
 * hosts are often internal tools, so the extension does not send their
 * tables until the user turns the site on.
 */
export const isPrivateHost = (host: string): boolean => {
  if (host === "") return false;
  if (host.startsWith("[")) return /^\[(::1|f[cd][0-9a-f]{0,2}:|fe[89ab][0-9a-f]:)/i.test(host);
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (v4 !== null) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return PRIVATE_IPV4.some(([first, low, high]) => a === first && b >= low && b <= high);
  }
  return host === "localhost" || !host.includes(".") || PRIVATE_SUFFIXES.some((s) => host.endsWith(s));
};

/** Returns true if the extension is on for `host`. */
export const siteEnabled = (s: Settings, host: string): boolean => {
  if (s.mode === "chosen" || isPrivateHost(host)) return s.enabledHosts.includes(host);
  return !s.disabledHosts.includes(host);
};

/** Returns a copy of `s` with `host` turned on or off in the current mode. */
export const setSiteEnabledIn = (s: Settings, host: string, enabled: boolean): Settings => {
  const without = (xs: readonly string[]) => xs.filter((h) => h !== host);
  return s.mode === "chosen" || isPrivateHost(host)
    ? { ...s, enabledHosts: enabled ? [...without(s.enabledHosts), host] : without(s.enabledHosts) }
    : { ...s, disabledHosts: enabled ? without(s.disabledHosts) : [...without(s.disabledHosts), host] };
};

/** Returns the config for the chosen provider, or null if its credentials are missing. */
export const providerConfig = (s: Settings, installId: string): ProviderConfig | null => {
  if (s.provider === "hosted") return { provider: "hosted", installId };
  if (s.provider === "jev") return s.typesafeApiKey === "" ? null : { provider: "jev", apiKey: s.typesafeApiKey };
  if (s.cloudflareAccountId === "" || s.cloudflareApiToken === "") return null;
  return { provider: "clef", accountId: s.cloudflareAccountId, apiToken: s.cloudflareApiToken, model: s.clefModel };
};

// ── Install id ──────────────────────────────────────────────────────────────

const INSTALL_ID = "installId";

/**
 * Returns a random id for this install, and creates it on first use. Only the
 * hosted endpoint receives it, to count each install's daily allowance. The id
 * comes from crypto.randomUUID, not from the user or the browser. Uninstalling
 * the extension deletes it.
 */
export const getInstallId = async (): Promise<string> => {
  const stored = (await chrome.storage.local.get(INSTALL_ID))[INSTALL_ID];
  if (typeof stored === "string" && stored !== "") return stored;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [INSTALL_ID]: id });
  return id;
};

// ── Per-page pause (session) ────────────────────────────────────────────────

const PAUSED = "pausedPages";

/** Returns the URL without its fragment, so in-page anchors count as the same page. */
export const pageKey = (url: string): string => url.split("#")[0] ?? url;

/** Returns true if the user paused this page in the current browser session. */
export const isPagePaused = async (url: string): Promise<boolean> => {
  const stored = await chrome.storage.session.get(PAUSED);
  return ((stored[PAUSED] as string[] | undefined) ?? []).includes(pageKey(url));
};

/** Pauses or resumes a page for the current browser session. */
export const setPagePaused = async (url: string, paused: boolean): Promise<void> => {
  const stored = await chrome.storage.session.get(PAUSED);
  const pages = new Set((stored[PAUSED] as string[] | undefined) ?? []);
  if (paused) pages.add(pageKey(url));
  else pages.delete(pageKey(url));
  await chrome.storage.session.set({ [PAUSED]: [...pages] });
};

// ── Per-table choices (session) ─────────────────────────────────────────────

/** The user's choices for one table. `orientation` is the direction to compare, and `hidden` turns off the shading. */
export interface TableChoice {
  readonly orientation?: "columns" | "rows";
  readonly hidden?: boolean;
}

const tablesKey = (url: string) => `tables:${pageKey(url)}`;

/** Returns the saved table choices for a page, keyed by table fingerprint. */
export const loadTableChoices = async (url: string): Promise<Record<string, TableChoice>> => {
  const stored = await chrome.storage.session.get(tablesKey(url));
  return (stored[tablesKey(url)] as Record<string, TableChoice> | undefined) ?? {};
};

/** Saves the table choices for a page until the browser session ends. */
export const saveTableChoices = (url: string, choices: Record<string, TableChoice>) =>
  chrome.storage.session.set({ [tablesKey(url)]: choices });
