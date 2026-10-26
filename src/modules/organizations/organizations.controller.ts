import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../common/types/authenticated-request';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { ListOrganizationsQueryDto } from './dto/list-organizations-query.dto';
import {
  OrganizationsService,
  type OrganizationPage,
  type OrganizationView,
} from './organizations.service';

@Controller('organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOrganizationDto,
  ): Promise<OrganizationView> {
    return this.organizations.create(user.userId, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListOrganizationsQueryDto,
  ): Promise<OrganizationPage> {
    return this.organizations.listForUser(user.userId, query.page, query.pageSize);
  }

  @Get(':organizationId')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' })) organizationId: string,
  ): Promise<OrganizationView> {
    return this.organizations.getForUser(user.userId, organizationId);
  }
}
