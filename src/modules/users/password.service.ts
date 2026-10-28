import { Injectable } from '@nestjs/common';
import { argon2id, hash, verify, type HashOptions } from 'argon2';

/**
 * Argon2id with OWASP's minimum parameters (19 MiB, t=2, p=1). The hash embeds
 * its parameters, so raising these later does not invalidate stored hashes.
 */
const ARGON2_OPTIONS: HashOptions = {
  type: argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return hash(plain, ARGON2_OPTIONS);
  }

  verify(passwordHash: string, plain: string): Promise<boolean> {
    return verify(passwordHash, plain);
  }
}
