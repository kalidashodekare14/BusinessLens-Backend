import { Injectable } from '@nestjs/common';
import { UsersService, type PublicUser } from '../users/users.service';
import type { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(private readonly users: UsersService) {}

  register(dto: RegisterDto): Promise<PublicUser> {
    return this.users.create(dto);
  }
}
