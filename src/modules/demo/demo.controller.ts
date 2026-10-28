import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type {
  AuthenticatedUser,
  CurrentOrganization,
} from '../../common/types/authenticated-request';
import { DemoDataService, type DemoLoadView } from './demo.service';

@Controller('organizations/:organizationId/demo-data')
@UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
export class DemoController {
  constructor(private readonly demo: DemoDataService) {}

  /** OWNER only (§12). The imports are queued; clients poll GET /imports (§12). */
  @Post()
  @Roles('OWNER')
  @HttpCode(202)
  load(
    @CurrentOrg() organization: CurrentOrganization,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DemoLoadView> {
    return this.demo.load(organization.id, user.userId);
  }
}
