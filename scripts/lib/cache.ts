/**
 * Reads and writes recorded model answers in fixtures/recordings/. The key is
 * the SHA-256 of the request body, the same key as the extension's cache.
 * The scripts and tests share one set of recordings, so an answer recorded by
 * one replays in all of them.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { Effect, Layer } from "effect";
import { AnswerCache, layerFromConfig, type DecisionResponse, type ProviderConfig } from "../../src/decide/model.ts";

const RECORDINGS = "fixtures/recordings";

export const fileCache = (dir = RECORDINGS) =>
  Layer.succeed(AnswerCache, {
    get: (key) =>
      Effect.promise(() =>
        readFile(`${dir}/${key}.json`, "utf8").then(
          (s) => JSON.parse(s) as DecisionResponse,
          () => undefined,
        ),
      ),
    set: (key, value) =>
      Effect.promise(async () => {
        await mkdir(dir, { recursive: true });
        // Write to a temporary file, then rename it. Parallel requests can record the same key at once.
        const tmp = `${dir}/.${key}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
        await writeFile(tmp, JSON.stringify(value))
          .then(() => rename(tmp, `${dir}/${key}.json`))
          .catch(() => undefined);
      }),
  });

/** The provider in `config`, Jev by default, behind the recordings. A question with no recording calls the provider and records its answer. */
export const recordedJev = (
  config: ProviderConfig = { provider: "jev", apiKey: process.env["TYPESAFE_API_KEY"] ?? "" },
) => Layer.merge(layerFromConfig(config), fileCache());
