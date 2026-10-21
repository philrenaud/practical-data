/** Helpers that decide who a request comes from. They have no Workers dependencies, so Node tests can load them. */

const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/**
 * Returns the key that the per-IP rate limit counts a client address under.
 * An IPv4 address is its own key. An IPv6 address is keyed by its /64
 * prefix, because one subscriber usually gets a whole /64 and can use any
 * address in it.
 */
export const rateLimitKey = (ip: string): string => {
  const mapped = IPV4_MAPPED.exec(ip);
  if (mapped !== null) return mapped[1]!;
  if (!ip.includes(":")) return ip;
  const [head = "", tail] = ip.split("::");
  const front = head === "" ? [] : head.split(":");
  const back = tail === undefined || tail === "" ? [] : tail.split(":");
  const groups =
    tail === undefined ? front : [...front, ...Array(Math.max(0, 8 - front.length - back.length)).fill("0"), ...back];
  const prefix = groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, ""));
  return `${prefix.join(":")}::/64`;
};
