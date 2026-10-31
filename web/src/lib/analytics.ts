/**
 * Anonymous visit statistics for the website, via PostHog. The script loads
 * only when a key is set and the browser does not ask not to be tracked
 * (Do Not Track or Global Privacy Control). Cookieless: PostHog keeps its
 * state in memory, writes nothing to cookies or local storage, and so cannot
 * link one visit to another. Page views are captured on load and on in-app
 * navigation; everything else is an explicit track() call. The extension
 * sends nothing here; this file is the website's only analytics code.
 */

/** The PostHog project's publishable key. Empty turns analytics off, as in local dev. */
const KEY = "";
const HOST = "https://us.i.posthog.com";
const SCRIPT = "https://us-assets.i.posthog.com/static/array.js";

type Props = Record<string, string>;
interface PostHog {
  init(key: string, config: Record<string, unknown>): void;
  capture(event: string, props?: Props, options?: Record<string, unknown>): void;
}
declare global {
  interface Window {
    posthog?: PostHog;
  }
}

/** Events recorded before the script loads; null once they can send, or when analytics is off. */
let pending: [string, Props][] | null = [];
let client: PostHog | null = null;

// A beacon survives the navigation when the click leaves the page.
const send = (ph: PostHog, event: string, props: Props) => ph.capture(event, props, { transport: "sendBeacon" });

/** Records one event. A no-op when analytics is off. */
export const track = (event: string, props: Props = {}): void => {
  if (client !== null) send(client, event, props);
  else pending?.push([event, props]);
};

/** Loads PostHog. Call once from the root layout, in the browser. */
export const init = (): void => {
  const declined =
    navigator.doNotTrack === "1" ||
    (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
  if (KEY === "" || declined) {
    pending = null;
    return;
  }
  const script = document.createElement("script");
  script.src = SCRIPT;
  script.async = true;
  script.onload = () => {
    window.posthog?.init(KEY, {
      api_host: HOST,
      // The 2025-05-24 defaults capture a page view on load and on each
      // history-API navigation, which SvelteKit's router uses.
      defaults: "2025-05-24",
      persistence: "memory",
      autocapture: false,
      disable_session_recording: true,
      loaded: (ph: PostHog) => {
        client = ph;
        for (const [event, props] of pending ?? []) send(ph, event, props);
        pending = null;
      },
    });
  };
  document.head.append(script);
};
