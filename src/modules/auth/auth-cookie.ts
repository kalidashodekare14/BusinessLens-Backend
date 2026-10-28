import type { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH, REFRESH_TOKEN_TTL_MS } from './token.constants';

/** Cookie flags per §6.4; values come from validated config, never from the request. */
export function refreshCookieOptions(config: ConfigService): CookieOptions {
  return {
    httpOnly: true,
    secure: config.getOrThrow<string>('COOKIE_SECURE') === 'true',
    sameSite: config.getOrThrow<'lax' | 'strict' | 'none'>('COOKIE_SAMESITE'),
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_TTL_MS,
  };
}

export function setRefreshCookie(res: Response, token: string, config: ConfigService): void {
  res.cookie(REFRESH_COOKIE_NAME, token, refreshCookieOptions(config));
}
