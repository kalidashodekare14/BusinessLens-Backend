import { Transform, type TransformFnParams } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { normalizeEmail } from '../../../common/utils/email';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../users/password.constants';

function normalizeEmailValue({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? normalizeEmail(value) : value;
}

function trimValue({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class RegisterDto {
  @Transform(normalizeEmailValue)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;

  @Transform(trimValue)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;
}
