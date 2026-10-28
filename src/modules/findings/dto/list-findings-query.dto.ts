import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { FindingStatus, FindingType, Severity } from '../../../generated/prisma/client';

export class ListFindingsQueryDto {
  @IsOptional()
  @ApiPropertyOptional({ enum: Object.values(FindingStatus), example: 'OPEN' })
  status?: FindingStatus;

  @IsOptional()
  @ApiPropertyOptional({ enum: Object.values(Severity), example: 'HIGH' })
  severity?: Severity;

  @IsOptional()
  @ApiPropertyOptional({ enum: Object.values(FindingType), example: 'REVENUE_DROP' })
  type?: FindingType;

  @IsOptional()
  @IsUUID('4')
  analysisRunId?: string;

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
}
