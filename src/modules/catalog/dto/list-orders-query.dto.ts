import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListOrdersQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1, example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20, example: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;

  /** Inclusive lower bound on `orderedAt`, ISO 8601. */
  @IsOptional()
  @IsDateString({}, { message: 'from must be an ISO 8601 date' })
  from?: string;

  /** Inclusive upper bound on `orderedAt`, ISO 8601. */
  @IsOptional()
  @IsDateString({}, { message: 'to must be an ISO 8601 date' })
  to?: string;
}
