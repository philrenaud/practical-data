/**
 * Cuts a saved page down to what the tests use: its title, its headings,
 * and its tables, in document order. Scripts, styles, ads and page chrome go.
 * Adds a source and attribution comment.
 *
 *   node scripts/strip-fixture.ts            # every fixtures/live/*.html
 *   node scripts/strip-fixture.ts <slug>…
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { serve } from "./serve.ts";

const sources = JSON.parse(await readFile("fixtures/live/sources.json", "utf8")) as { slug: string; url: string }[];
const slugs = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : (await readdir("fixtures/live")).filter((f) => f.endsWith(".html")).map((f) => f.replace(/\.html$/, ""));

const { url, server } = await serve("fixtures");
const browser = await chromium.launch();
const page = await browser.newPage();
await page.route("**/*", (r) => (r.request().url().startsWith(url) ? r.continue() : r.abort()));

for (const slug of slugs) {
  await page.goto(`${url}/live/${slug}.html`, { waitUntil: "domcontentloaded" });
  const { title, body } = await page.evaluate(() => {
    const keep: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => {
        const el = n as Element;
        if (el.tagName === "TABLE") return el.parentElement?.closest("table") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        return /^H[1-4]$/.test(el.tagName) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      const el = (n as Element).cloneNode(true) as Element;
      el.querySelectorAll("script, noscript, iframe, link, img, video, svg").forEach((x) => x.remove());
      // Links matter only as footnote markers (<sup><a>); elsewhere keep just their text.
      el.querySelectorAll("a").forEach((a) => {
        if (a.closest("sup") !== null) {
          a.removeAttribute("href");
          return;
        }
        a.replaceWith(...a.childNodes);
      });
      // Keep only attributes that change what is extracted or shown.
      const KEEP = new Set(["colspan", "rowspan", "class", "style", "hidden", "scope", "bgcolor"]);
      for (const node of [el, ...el.querySelectorAll("*")]) {
        for (const attr of [...node.attributes]) if (!KEEP.has(attr.name)) node.removeAttribute(attr.name);
      }
      keep.push(el.outerHTML);
    }
    return { title: document.title, body: keep.join("\n") };
  });
  const source = sources.find((s) => s.slug === slug)?.url ?? "unknown";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title.replace(/</g, "&lt;")}</title>
<!--
  Test fixture: headings and tables only, from ${source}
  Retrieved October 2026 for testing table extraction. See fixtures/NOTICE.md.
-->
</head>
<body>
${body}
</body>
</html>
`;
  await writeFile(`fixtures/live/${slug}.html`, html);
  console.log(`${slug.padEnd(36)} ${(html.length / 1024).toFixed(0)} KB`);
}
await browser.close();
server.close();
