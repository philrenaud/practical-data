/**
 * Recorded model answers on disk, keyed like the extension's cache (sha-256
 * of the request body). Shared by eval, demo-data, explain-url and
 * readme-media so a recording made by one replays in all of them.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { Effect, Layer } from "effect";
import { AnswerCache, layerFromConfig, type DecisionResponse, type ProviderConfig } from "../../src/decide/model.ts";

export const RECORDINGS = "fixtures/recordings";

export const fileCache = (dir = RECORDINGS) =>
  Layer.succeed(AnswerCache, {
    get: (key) =>
      Effect.promise(() => readFile(`${dir}/${key}.json`, "utf8").then((s) => JSON.parse(s) as DecisionResponse, () => undefined)),
    set: (key, value) =>
      Effect.promise(async () => {
        await mkdir(dir, { recursive: true });
        // Write-then-rename: parallel requests can record the same key at once.
        const tmp = `${dir}/.${key}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
        await writeFile(tmp, JSON.stringify(value))
          .then(() => rename(tmp, `${dir}/${key}.json`))
          .catch(() => undefined);
      }),
  });

/** Jev with recordings: replays what exists, records what doesn't (needs TYPESAFE_API_KEY). */
export const recordedJev = (config: ProviderConfig = { provider: "jev", apiKey: process.env["TYPESAFE_API_KEY"] ?? "" }) =>
  Layer.merge(layerFromConfig(config), fileCache());
