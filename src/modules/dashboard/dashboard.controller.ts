import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import type { CurrentOrganization } from '../../common/types/authenticated-request';
import { DashboardService, type DashboardView } from './dashboard.service';

@Controller('organizations/:organizationId/dashboard')
@UseGuards(JwtAuthGuard, OrgMembershipGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  get(@CurrentOrg() organization: CurrentOrganization): Promise<DashboardView> {
    return this.dashboard.get(organization.id);
  }
}
