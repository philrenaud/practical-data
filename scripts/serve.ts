/** Minimal static server for fixtures; Playwright can't load extensions on file:// reliably. */
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json",
  ".css": "text/css",
  ".js": "text/javascript",
  ".png": "image/png",
  ".zip": "application/zip",
};

export const serve = (root: string): Promise<{ url: string; server: Server }> =>
  new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const raw = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
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
      resolve({ url: `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`, server });
    });
  });

/** Every fixture page as { slug, path } relative to fixtures/. */
export const fixturePages = async (): Promise<{ slug: string; path: string }[]> => {
  const { readdir } = await import("node:fs/promises");
  const out: { slug: string; path: string }[] = [];
  for (const dir of ["live", "synthetic"]) {
    for (const f of (await readdir(join("fixtures", dir)).catch(() => [])).sort()) {
      if (f.endsWith(".html")) out.push({ slug: f.replace(/\.html$/, ""), path: `${dir}/${f}` });
    }
  }
  return out;
};
