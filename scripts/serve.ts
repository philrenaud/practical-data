/** A static file server for fixtures and built sites. Playwright cannot reliably run the extension on file:// pages. */
import { createServer, type Server } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json",
  ".css": "text/css",
  ".js": "text/javascript",
  ".png": "image/png",
  ".zip": "application/zip",
};

/**
 * The host that browser harnesses load pages from. The extension is off on
 * private hosts such as 127.0.0.1 until the user turns them on, so pages are
 * served under a public-looking name that `EXTENSION_ARGS` maps to loopback.
 * `.test` is reserved for testing (RFC 2606).
 */
export const PAGE_HOST = "fixtures.test";

/** Chromium arguments that load dist/ and resolve `PAGE_HOST` to the local server. */
export const EXTENSION_ARGS = [
  "--disable-extensions-except=dist",
  "--load-extension=dist",
  `--host-resolver-rules=MAP ${PAGE_HOST} 127.0.0.1`,
];

/**
 * Serves `root` on loopback. `url` is for Node and for browsers without
 * `EXTENSION_ARGS`; `pagesUrl` is the same server under `PAGE_HOST`.
 */
export const serve = (root: string): Promise<{ url: string; pagesUrl: string; server: Server }> =>
  new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      // Strip leading "../" so that a request cannot leave `root`.
      const raw = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)).replace(
        /^(\.\.[/\\])+/,
        "",
      );
      const path = raw.endsWith("/") ? `${raw}index.html` : raw;
      try {
        const body = await readFile(join(root, path));
        res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
        res.end(body);
      } catch {
        res.writeHead(404).end();
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, pagesUrl: `http://${PAGE_HOST}:${port}`, server });
    });
  });

/** Lists the HTML pages in fixtures/live/ and fixtures/synthetic/, with paths relative to fixtures/. */
export const fixturePages = async (): Promise<{ slug: string; path: string }[]> => {
  const out: { slug: string; path: string }[] = [];
  for (const dir of ["live", "synthetic"]) {
    for (const f of (await readdir(join("fixtures", dir)).catch(() => [])).sort()) {
      if (f.endsWith(".html")) out.push({ slug: f.replace(/\.html$/, ""), path: `${dir}/${f}` });
    }
  }
  return out;
};
