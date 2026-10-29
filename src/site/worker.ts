/**
 * The site Worker at practicaldata.dev. Static files come from the assets
 * binding. The one exception is the Cambridge web font, whose license keeps
 * the file out of the public repository: it lives in a private R2 bucket
 * and is served from there.
 */

interface Env {
  readonly FONTS: R2Bucket;
  readonly ASSETS: Fetcher;
}

const FONT = "Cambridge-Light.woff2";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method === "GET" && pathname === `/fonts/${FONT}`) {
      const font = await env.FONTS.get(FONT);
      if (font === null) return new Response("Not found.", { status: 404 });
      return new Response(font.body, {
        headers: {
          "Content-Type": "font/woff2",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }
    return env.ASSETS.fetch(request);
  },
};
