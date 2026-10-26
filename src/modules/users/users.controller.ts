import { Body, Controller, Get, HttpCode, Patch, Post, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../common/types/authenticated-request';
import { clearRefreshCookie } from '../auth/auth-cookie';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService, type MeUser, type PublicUser } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): Promise<MeUser> {
    return this.users.getMe(user.userId);
  }

  @Patch('me')
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<PublicUser> {
    return this.users.updateProfile(user.userId, dto);
  }

  @Post('me/change-password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.users.changePassword(user.userId, dto);
    // Every refresh token is revoked, so the browser must drop this one too.
    clearRefreshCookie(res, this.config);
  }
}
