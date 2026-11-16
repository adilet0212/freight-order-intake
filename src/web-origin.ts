/**
 * Where the web app is served in development. Vite is started with `strictPort` on 5173
 * (web/vite.config.ts), so this is the origin a browser sends when the README is followed.
 */
export const DEFAULT_WEB_ORIGIN = 'http://localhost:5173';

/**
 * The browser origins allowed to call the API: WEB_ORIGIN (one, or several separated by
 * commas), or the default. The HTTP routes and the live-updates socket both use this list.
 *
 * Call it when the value is needed, never at import time: source files are imported before
 * ConfigModule has loaded .env, so a value read at import would miss it.
 */
export function allowedWebOrigins(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const origins = (env.WEB_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  return origins.length > 0 ? origins : [DEFAULT_WEB_ORIGIN];
}
