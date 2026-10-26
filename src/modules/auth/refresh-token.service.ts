import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { REFRESH_TOKEN_TTL_MS } from './token.constants';
import { generateRefreshToken, hashRefreshToken } from './refresh-token.util';

export type RotateRefreshTokenResult =
  | { status: 'ok'; userId: string; refreshToken: string }
  | { status: 'invalid' }
  | { status: 'reuse' };

/** Raised inside the transaction when another request claimed the same token. */
class ConcurrentRotationError extends Error {}

@Injectable()
export class RefreshTokenService {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates a refresh token row and returns the raw value for the cookie. */
  async issue(userId: string): Promise<string> {
    const rawToken = generateRefreshToken();

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashRefreshToken(rawToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });

    return rawToken;
  }

  /**
   * Single-use rotation (§6.4). A revoked or replayed token revokes every active
   * token for the user (assume theft). The compare-and-set update stops two
   * concurrent refreshes from both succeeding.
   */
  async rotate(rawToken: string): Promise<RotateRefreshTokenResult> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(rawToken) },
    });

    if (!stored) {
      return { status: 'invalid' };
    }
    if (stored.revokedAt) {
      await this.revokeAllForUser(stored.userId);
      return { status: 'reuse' };
    }
    if (stored.expiresAt.getTime() <= Date.now()) {
      return { status: 'invalid' };
    }

    try {
      const refreshToken = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.refreshToken.updateMany({
          where: { id: stored.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        if (claimed.count === 0) {
          throw new ConcurrentRotationError();
        }

        const nextRawToken = generateRefreshToken();
        const created = await tx.refreshToken.create({
          data: {
            userId: stored.userId,
            tokenHash: hashRefreshToken(nextRawToken),
            expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
          },
        });
        await tx.refreshToken.update({
          where: { id: stored.id },
          data: { replacedById: created.id },
        });

        return nextRawToken;
      });

      return { status: 'ok', userId: stored.userId, refreshToken };
    } catch (error) {
      if (error instanceof ConcurrentRotationError) {
        await this.revokeAllForUser(stored.userId);
        return { status: 'reuse' };
      }
      throw error;
    }
  }

  /** Revokes the presented token only; logout is idempotent. Returns its owner, if any. */
  async revoke(rawToken: string): Promise<string | null> {
    const tokenHash = hashRefreshToken(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { userId: true },
    });
    if (!stored) {
      return null;
    }

    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return stored.userId;
  }

  private async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
