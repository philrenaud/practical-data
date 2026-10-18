declare const PD_API_ORIGIN: string | undefined;

/** The hosted endpoint's origin; builds can point it elsewhere with PD_API_ORIGIN. */
export const API_ORIGIN = typeof PD_API_ORIGIN === "string" ? PD_API_ORIGIN : "https://api.practicaldata.dev";
