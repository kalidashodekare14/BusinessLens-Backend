import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class ListOrganizationsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;
}
