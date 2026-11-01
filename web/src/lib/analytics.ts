/**
 * Anonymous referrer statistics for the website (not the extension), via PostHog.
 * Loads only when a key is set and the browser does not ask not to be tracked
 * (Do Not Track or Global Privacy Control). No cookies.
 */

/** The PostHog project's key. Publishable: it ships in the bundle anyway. Empty turns analytics off. */
const KEY = "phc_AQVmefzPBveL8y7b8MaXB4GAemnzwyT6jegnawRi5nHi";
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
