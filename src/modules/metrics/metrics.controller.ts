import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import type { CurrentOrganization } from '../../common/types/authenticated-request';
import { MetricsService } from './metrics.service';
import type { MetricsOverviewView } from './metrics.types';

@Controller('organizations/:organizationId/metrics')
@UseGuards(JwtAuthGuard, OrgMembershipGuard)
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('overview')
  overview(@CurrentOrg() organization: CurrentOrganization): Promise<MetricsOverviewView> {
    return this.metrics.getOverview(organization.id);
  }
}
