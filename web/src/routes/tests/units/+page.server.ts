import { readIndex } from "#lib/server/tests.ts";

export const load = async () => {
  const { units, parsing } = await readIndex();
  return { units, parsing };
};
