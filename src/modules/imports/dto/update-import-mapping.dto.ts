import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

export class UpdateImportMappingDto {
  /** Canonical field name -> detected column header (or null). The service
   * validates the keys and values against the import type and detected headers. */
  @ApiProperty({
    type: Object,
    additionalProperties: { type: String, nullable: true },
    example: { orderId: 'Order ID', orderedAt: 'Order Date', quantity: 'Qty' },
  })
  @IsObject()
  mapping!: Record<string, unknown>;
}
