/**
 * Anonymous usage data points for Workers Analytics Engine. A data point has
 * no install id, no IP address, no location, and no table text. It has the
 * route, the outcome, and counts. Cloudflare keeps the data for three months.
 * `scripts/api-usage.ts` queries it.
 *
 *   blob1   route: "systemone", "stats", or "other"
 *   blob2   outcome: "cache", "model", "ok", or the refusal's error code
 *   double1 HTTP status
 *   double2 input tokens that the model used (outcome "model" only)
 *   double3 the install's model requests today, this one included
 *           (outcomes "model" and "install_limit" only)
 *   index1  outcome, so that sampling keeps rare outcomes
 */

export interface DataPoint {
  readonly blobs: readonly string[];
  readonly doubles: readonly number[];
  readonly indexes: readonly string[];
}

const ROUTES: Readonly<Record<string, string>> = { "/v1/systemone": "systemone", "/v1/stats": "stats" };

const readJson = (response: Response): Promise<Record<string, unknown> | null> =>
  response.json().then(
    (v) => (typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null),
    () => null,
  );

/**
 * Returns the data point for one response. `response` must be a clone,
 * because this function reads its body.
 */
export const usagePoint = async (pathname: string, response: Response): Promise<DataPoint> => {
  const route = ROUTES[pathname] ?? "other";
  const remaining = response.headers.get("x-practical-data-remaining");
  const limit = Number(response.headers.get("x-practical-data-limit"));
  const used = remaining === null || !Number.isFinite(limit) ? 0 : limit - Number(remaining);
  const body = await readJson(response);

  let outcome: string;
  let tokens = 0;
  if (!response.ok) outcome = typeof body?.["error"] === "string" ? body["error"] : "error";
  else if (route !== "systemone") outcome = "ok";
  else if (remaining === null) outcome = "cache";
  else {
    outcome = "model";
    const usage = body?.["usage"] as { input_tokens?: unknown } | undefined;
    tokens = typeof usage?.input_tokens === "number" ? usage.input_tokens : 0;
  }
  const counted = outcome === "model" || outcome === "install_limit";
  return { blobs: [route, outcome], doubles: [response.status, tokens, counted ? used : 0], indexes: [outcome] };
};
