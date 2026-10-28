/** §6.4: access token 15 minutes, refresh token 7 days. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const REFRESH_COOKIE_NAME = 'bl_refresh';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';
