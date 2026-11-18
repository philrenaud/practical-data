/**
 * Tells a temperature column from other columns in degrees. Kept free of the
 * color libraries so the judge can use it as well as the painter.
 */

/** Units that always mean a temperature. */
const TEMPERATURE_UNITS = new Set(["°C", "°F"]);
/** Header words for a bare `°` that is an angle, a direction or a coordinate, not a temperature. */
const ANGLE_HEADER =
  /^(?:dir|direction|bearing|heading|course|angle|azimuth|lat|latitude|lon|lng|long|longitude|slope|incline|inclination|tilt|pitch|roll|yaw|rotation|elevation|altitude|declination|wind)$/;
/** A bare `°` beyond this is more likely an angle (0–360) than a temperature. */
const TEMPERATURE_RANGE: readonly [number, number] = [-90, 140];

/**
 * True when a number column holds temperatures, whatever its direction.
 * `°C` and `°F` always count. A bare `°` counts only when the header names no
 * angle, direction or coordinate ("Wind", "Bearing", "Lat") and every value
 * is within -90 to 140, since bearings run to 360.
 */
export const isTemperatureColumn = (
  header: string,
  unit: string | null,
  domain: readonly [number, number],
): boolean => {
  if (unit === null) return false;
  if (TEMPERATURE_UNITS.has(unit)) return true;
  if (unit !== "°") return false;
  const words = header.toLowerCase().split(/[^a-z]+/);
  if (words.some((w) => ANGLE_HEADER.test(w))) return false;
  return domain[0] >= TEMPERATURE_RANGE[0] && domain[1] <= TEMPERATURE_RANGE[1];
};
