import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import type { CurrentOrganization } from '../../common/types/authenticated-request';
import { CatalogService, type OrderPage, type ProductPage } from './catalog.service';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';

@Controller('organizations/:organizationId')
@UseGuards(JwtAuthGuard, OrgMembershipGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('products')
  listProducts(
    @CurrentOrg() organization: CurrentOrganization,
    @Query() query: ListProductsQueryDto,
  ): Promise<ProductPage> {
    return this.catalog.listProducts(organization.id, query.page, query.pageSize);
  }

  @Get('orders')
  listOrders(
    @CurrentOrg() organization: CurrentOrganization,
    @Query() query: ListOrdersQueryDto,
  ): Promise<OrderPage> {
    return this.catalog.listOrders(organization.id, query);
  }
}
