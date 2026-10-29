/**
 * The Workers runtime types that src/site uses. They are declared here so the
 * project does not depend on @cloudflare/workers-types.
 */

interface R2ObjectBody {
  readonly body: ReadableStream;
}

interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
}

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}
