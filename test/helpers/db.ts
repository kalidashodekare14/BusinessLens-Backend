import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Removes test users and everything that references them, respecting the
 * RESTRICT foreign keys. Scoped by email so parallel suites stay isolated.
 */
export async function deleteUsersByEmail(app: INestApplication, emails: string[]): Promise<void> {
  if (emails.length === 0) {
    return;
  }

  const prisma = app.get(PrismaService);
  const users = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true },
  });
  const ids = users.map((user) => user.id);
  if (ids.length === 0) {
    return;
  }

  await prisma.$transaction([
    prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } }),
    prisma.membership.deleteMany({ where: { userId: { in: ids } } }),
    prisma.user.deleteMany({ where: { id: { in: ids } } }),
  ]);
}

/** Removes organizations created directly by tests (Membership first: FK RESTRICT). */
export async function deleteOrganizationsById(
  app: INestApplication,
  organizationIds: string[],
): Promise<void> {
  if (organizationIds.length === 0) {
    return;
  }

  const prisma = app.get(PrismaService);
  await prisma.$transaction([
    prisma.membership.deleteMany({ where: { organizationId: { in: organizationIds } } }),
    prisma.organization.deleteMany({ where: { id: { in: organizationIds } } }),
  ]);
}
