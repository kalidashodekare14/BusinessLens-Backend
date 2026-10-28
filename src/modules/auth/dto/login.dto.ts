import { Transform, type TransformFnParams } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { normalizeEmail } from '../../../common/utils/email';
import { PASSWORD_MAX_LENGTH } from '../../users/password.constants';

function normalizeEmailValue({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? normalizeEmail(value) : value;
}

export class LoginDto {
  @Transform(normalizeEmailValue)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}
