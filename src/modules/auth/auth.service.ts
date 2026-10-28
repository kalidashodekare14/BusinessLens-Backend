import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { apiError } from '../../common/errors/api-error';
import { PasswordService } from '../users/password.service';
import { UsersService, type PublicUser } from '../users/users.service';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import { RefreshTokenService } from './refresh-token.service';
import { ACCESS_TOKEN_TTL_SECONDS } from './token.constants';

export interface LoginResult {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private dummyHash?: Promise<string>;

  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  register(dto: RegisterDto): Promise<PublicUser> {
    return this.users.create(dto);
  }

  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.users.findByEmail(dto.email);
    const passwordMatches = await this.verifyPassword(user?.passwordHash ?? null, dto.password);

    // Same response for unknown email and wrong password (§6.4).
    if (!user || !passwordMatches) {
      throw apiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    }

    // Claims: sub only. The organization is never in the token (§6.4).
    const accessToken = await this.jwt.signAsync({ sub: user.id });
    const refreshToken = await this.refreshTokens.issue(user.id);

    return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS, refreshToken };
  }

  private async verifyPassword(passwordHash: string | null, plain: string): Promise<boolean> {
    // Always run one Argon2 verify so unknown emails are not distinguishable by timing.
    if (!passwordHash) {
      await this.passwords.verify(await this.getDummyHash(), plain);
      return false;
    }

    try {
      return await this.passwords.verify(passwordHash, plain);
    } catch {
      return false;
    }
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.passwords.hash('timing-only-placeholder-password');
    return this.dummyHash;
  }
}
