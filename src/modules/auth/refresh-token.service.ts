import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { REFRESH_TOKEN_TTL_MS } from './token.constants';
import { generateRefreshToken, hashRefreshToken } from './refresh-token.util';

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
}
