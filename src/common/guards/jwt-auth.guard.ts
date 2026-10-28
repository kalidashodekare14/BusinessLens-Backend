import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { apiError } from '../errors/api-error';
import type { AuthenticatedRequest } from '../types/authenticated-request';

const BEARER = /^Bearer\s+(.+)$/i;

/**
 * Verifies the Bearer access token and exposes only `{ userId }` from the `sub`
 * claim. No other claim is trusted (§6.4). Missing, malformed and invalid tokens
 * all produce the same 401 so the client learns nothing about the reason.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    const match = typeof header === 'string' ? BEARER.exec(header) : null;
    const token = match?.[1]?.trim();

    if (!token) {
      throw apiError(401, 'UNAUTHORIZED', 'Authentication required.');
    }

    try {
      const payload = await this.jwt.verifyAsync<{ sub?: unknown }>(token);
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw new Error('missing sub claim');
      }

      request.user = { userId: payload.sub };
      return true;
    } catch {
      throw apiError(401, 'UNAUTHORIZED', 'Authentication required.');
    }
  }
}
