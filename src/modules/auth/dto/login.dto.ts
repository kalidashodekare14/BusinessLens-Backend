import { ApiProperty } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { normalizeEmail } from '../../../common/utils/email';
import { PASSWORD_MAX_LENGTH } from '../../users/password.constants';

function normalizeEmailValue({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? normalizeEmail(value) : value;
}

export class LoginDto {
  @ApiProperty({ format: 'email', example: 'owner@example.com' })
  @Transform(normalizeEmailValue)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ minLength: 1, maxLength: PASSWORD_MAX_LENGTH, example: 'correct horse battery staple' })
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}
