import { Injectable } from '@nestjs/common';
import { apiError } from '../../common/errors/api-error';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import type { ListOrdersQueryDto } from './dto/list-orders-query.dto';

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
}

export interface ProductView {
  id: string;
  name: string;
  sku: string | null;
  /** Money is a string in JSON (§12). */
  price: string | null;
}

export interface ProductPage {
  data: ProductView[];
  meta: PageMeta;
}

export interface OrderView {
  id: string;
  externalId: string;
  orderedAt: Date;
  status: string;
  /** Money is a string in JSON (§12). */
  total: string;
  itemCount: number;
}

export interface OrderPage {
  data: OrderView[];
  meta: PageMeta;
}

@Injectable()
export class CatalogService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async listProducts(organizationId: string, page: number, pageSize: number): Promise<ProductPage> {
    const { products, total } = await this.tenantPrisma.run(organizationId, async (tx) => {
      const [products, total] = await Promise.all([
        tx.product.findMany({
          where: { organizationId },
          orderBy: { name: 'asc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: { id: true, name: true, sku: true, price: true },
        }),
        tx.product.count({ where: { organizationId } }),
      ]);
      return { products, total };
    });

    return {
      data: products.map((product) => ({
        id: product.id,
        name: product.name,
        sku: product.sku,
        price: product.price === null ? null : product.price.toFixed(2),
      })),
      meta: { page, pageSize, total },
    };
  }

  async listOrders(organizationId: string, query: ListOrdersQueryDto): Promise<OrderPage> {
    const orderedAt: { gte?: Date; lte?: Date } = {};
    if (query.from) {
      orderedAt.gte = new Date(query.from);
    }
    if (query.to) {
      orderedAt.lte = new Date(query.to);
    }
    if (orderedAt.gte && orderedAt.lte && orderedAt.gte > orderedAt.lte) {
      throw apiError(400, 'VALIDATION_FAILED', 'Validation failed', [
        { field: 'from', message: 'must not be after to' },
      ]);
    }

    const page = query.page;
    const pageSize = query.pageSize;
    const where = { organizationId, orderedAt };

    const { orders, total } = await this.tenantPrisma.run(organizationId, async (tx) => {
      const [orders, total] = await Promise.all([
        tx.order.findMany({
          where,
          orderBy: [{ orderedAt: 'desc' }, { externalId: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            externalId: true,
            orderedAt: true,
            status: true,
            total: true,
            _count: { select: { items: true } },
          },
        }),
        tx.order.count({ where }),
      ]);
      return { orders, total };
    });

    return {
      data: orders.map((order) => ({
        id: order.id,
        externalId: order.externalId,
        orderedAt: order.orderedAt,
        status: order.status,
        total: order.total.toFixed(2),
        itemCount: order._count.items,
      })),
      meta: { page, pageSize, total },
    };
  }
}
