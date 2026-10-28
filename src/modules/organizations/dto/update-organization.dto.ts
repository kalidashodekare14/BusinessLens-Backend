import { Transform, type TransformFnParams } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

function trimValue({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class UpdateOrganizationDto {
  @Transform(trimValue)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;
}
