import { PasswordService } from '../../../src/modules/users/password.service';

describe('PasswordService', () => {
  const passwords = new PasswordService();
  const plain = 'correct horse battery staple';

  it('hashes with Argon2id and verifies the right password', async () => {
    const passwordHash = await passwords.hash(plain);

    expect(passwordHash.startsWith('$argon2id$')).toBe(true);
    await expect(passwords.verify(passwordHash, plain)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const passwordHash = await passwords.hash(plain);

    await expect(passwords.verify(passwordHash, 'wrong password')).resolves.toBe(false);
  });

  it('salts every hash so the same password hashes differently', async () => {
    const first = await passwords.hash(plain);
    const second = await passwords.hash(plain);

    expect(first).not.toBe(second);
    expect(first).not.toContain(plain);
  });
});
