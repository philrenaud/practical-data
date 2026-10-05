/** Test-only entry: exposes the extractor to Playwright via page.addScriptTag. */
import { extractPage } from "./extract.ts";

(globalThis as { __practicalData?: unknown }).__practicalData = {
  extractPage: () => extractPage(document).page,
};
