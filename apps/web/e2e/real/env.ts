/** Ports and names for the real-API e2e run (playwright.real.config.ts). */
export const WEB_PORT = 3310;
export const API_PORT = 3311;
/** localhost, not 127.0.0.1: the API compares Origin with WEB_ORIGIN as a string */
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
export const API_ORIGIN = `http://localhost:${API_PORT}`;
export const REAL_DB = "cq_web_e2e";
