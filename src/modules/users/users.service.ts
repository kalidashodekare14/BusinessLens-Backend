import { Injectable } from '@nestjs/common';
import { Prisma, type MembershipRole } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { apiError } from '../../common/errors/api-error';
import { normalizeEmail } from '../../common/utils/email';
import { PasswordService } from './password.service';

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
}

export interface UserCredentials {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
}

export interface UserOrganization {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  role: MembershipRole;
}

export interface MeUser extends PublicUser {
  organizations: UserOrganization[];
}

const PUBLIC_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  async create(input: CreateUserInput): Promise<PublicUser> {
    const passwordHash = await this.passwords.hash(input.password);

    try {
      return await this.prisma.user.create({
        data: {
          email: normalizeEmail(input.email),
          name: input.name.trim(),
          passwordHash,
        },
        select: PUBLIC_USER_SELECT,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Generic wording: registering must not confirm that an email exists (§6.4).
        throw apiError(409, 'CONFLICT', 'An account with these details could not be created.');
      }
      throw error;
    }
  }

  findByEmail(email: string): Promise<UserCredentials | null> {
    return this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
      select: { id: true, email: true, name: true, passwordHash: true },
    });
  }

  async getMe(userId: string): Promise<MeUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        memberships: {
          orderBy: { createdAt: 'asc' },
          select: {
            role: true,
            organization: {
              select: { id: true, name: true, currency: true, timezone: true },
            },
          },
        },
      },
    });

    if (!user) {
      throw apiError(404, 'NOT_FOUND', 'User not found.');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
      organizations: user.memberships.map(({ role, organization }) => ({
        ...organization,
        role,
      })),
    };
  }

  async updateProfile(userId: string, input: { name: string }): Promise<PublicUser> {
    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: { name: input.name.trim() },
        select: PUBLIC_USER_SELECT,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw apiError(404, 'NOT_FOUND', 'User not found.');
      }
      throw error;
    }
  }

  async changePassword(
    userId: string,
    input: { currentPassword: string; newPassword: string },
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!user) {
      throw apiError(404, 'NOT_FOUND', 'User not found.');
    }

    const matches = await this.passwords
      .verify(user.passwordHash, input.currentPassword)
      .catch(() => false);
    if (!matches) {
      throw apiError(400, 'INVALID_CURRENT_PASSWORD', 'Current password is incorrect.');
    }

    const passwordHash = await this.passwords.hash(input.newPassword);

    // RefreshToken is a non-tenant auth table, so revoking sessions here keeps
    // UsersModule independent of AuthModule (no dependency cycle).
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }
}
