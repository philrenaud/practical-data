/**
 * Test-only bundle. It sets `globalThis.__practicalData.extractPage` for
 * Playwright scripts that load it with page.addScriptTag.
 */
import { extractPage } from "./extract.ts";

(globalThis as { __practicalData?: unknown }).__practicalData = {
  extractPage: () => extractPage(document).page,
};
