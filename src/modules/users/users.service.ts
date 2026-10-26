import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
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
}
