import type { Request } from 'express';

/** What JwtAuthGuard attaches after verifying an access token. */
export interface AuthenticatedUser {
  userId: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}
