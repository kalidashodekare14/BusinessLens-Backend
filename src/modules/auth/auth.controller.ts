import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService, type RegisterResult } from './auth.service';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './auth-cookie';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import type { PublicUser } from '../users/users.service';

@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('register')
  @HttpCode(201)
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Omit<RegisterResult, 'refreshToken' | 'user'> & PublicUser> {
    const session = await this.auth.register(dto);
    setRefreshCookie(res, session.refreshToken, this.config);

    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      createdAt: session.user.createdAt,
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
    };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const session = await this.auth.login(dto);
    setRefreshCookie(res, session.refreshToken, this.config);

    // The refresh token lives only in the httpOnly cookie, never in the body.
    return { accessToken: session.accessToken, expiresIn: session.expiresIn };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    try {
      const session = await this.auth.refresh(readRefreshCookie(req));
      setRefreshCookie(res, session.refreshToken, this.config);
      return { accessToken: session.accessToken, expiresIn: session.expiresIn };
    } catch (error) {
      // Never leave an invalid or replayed token in the browser.
      if (error instanceof HttpException && error.getStatus() === 401) {
        clearRefreshCookie(res, this.config);
      }
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(readRefreshCookie(req));
    clearRefreshCookie(res, this.config);
  }
}
