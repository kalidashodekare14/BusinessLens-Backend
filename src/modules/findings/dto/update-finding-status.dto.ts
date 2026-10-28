import { IsEnum } from 'class-validator';
import { FindingStatus } from '../../../generated/prisma/client';

export class UpdateFindingStatusDto {
  @IsEnum(FindingStatus)
  status!: FindingStatus;
}
