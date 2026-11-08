/**
 * Reads and writes recorded model answers in fixtures/recordings/. The key is
 * the SHA-256 of the request body, the same key as the extension's cache.
 * The scripts and tests share one set of recordings, so an answer recorded by
 * one replays in all of them.
 */
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import {
  modelFromConfig,
  type AnswerCache,
  type DecisionModel,
  type DecisionResponse,
  type ProviderConfig,
} from "../../src/decide/model.ts";

const RECORDINGS = "fixtures/recordings";

/**
 * With RECORDINGS_LOG set, appends every key a replay asks for to that file.
 * scripts/prune-recordings.ts runs the replay entrypoints under it to learn
 * which recordings are still referenced.
 */
export const logKey = async (key: string): Promise<void> => {
  const log = process.env["RECORDINGS_LOG"];
  if (log !== undefined) await appendFile(log, `${key}\n`).catch(() => undefined);
};

export const fileCache = (dir = RECORDINGS): AnswerCache => ({
  get: async (key) => {
    await logKey(key);
    return readFile(`${dir}/${key}.json`, "utf8").then(
      (s) => JSON.parse(s) as DecisionResponse,
      () => undefined,
    );
  },
  set: async (key, value) => {
    await mkdir(dir, { recursive: true });
    // Write to a temporary file, then rename it. Parallel requests can record the same key at once.
    const tmp = `${dir}/.${key}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(tmp, JSON.stringify(value))
      .then(() => rename(tmp, `${dir}/${key}.json`))
      .catch(() => undefined);
  },
});

/** The provider in `config`, Jev by default, behind the recordings. A question with no recording calls the provider and records its answer. */
export const recordedJev = (
  config: ProviderConfig = { provider: "jev", apiKey: process.env["TYPESAFE_API_KEY"] ?? "" },
): DecisionModel => modelFromConfig(config, fileCache());
