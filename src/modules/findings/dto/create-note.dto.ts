import { Transform, type TransformFnParams } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

function trimValue({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateNoteDto {
  /** Plain text, author-attributed (§11); trimmed before validation. */
  @Transform(trimValue)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;
}
