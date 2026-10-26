import type { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH, REFRESH_TOKEN_TTL_MS } from './token.constants';

/** Cookie flags per §6.4; values come from validated config, never from the request. */
function baseRefreshCookieOptions(config: ConfigService): CookieOptions {
  return {
    httpOnly: true,
    secure: config.getOrThrow<string>('COOKIE_SECURE') === 'true',
    sameSite: config.getOrThrow<'lax' | 'strict' | 'none'>('COOKIE_SAMESITE'),
    path: REFRESH_COOKIE_PATH,
  };
}

export function refreshCookieOptions(config: ConfigService): CookieOptions {
  return { ...baseRefreshCookieOptions(config), maxAge: REFRESH_TOKEN_TTL_MS };
}

export function readRefreshCookie(req: Request): string | undefined {
  const value = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE_NAME];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function setRefreshCookie(res: Response, token: string, config: ConfigService): void {
  res.cookie(REFRESH_COOKIE_NAME, token, refreshCookieOptions(config));
}

export function clearRefreshCookie(res: Response, config: ConfigService): void {
  // Clear with the same path/flags, otherwise the browser keeps the old cookie.
  res.clearCookie(REFRESH_COOKIE_NAME, baseRefreshCookieOptions(config));
}
