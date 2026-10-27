import { buildRedisConnectionOptions } from '../../../src/queues/redis-connection';

describe('buildRedisConnectionOptions', () => {
  it('uses the URL host and port and removes the per-request retry limit', () => {
    const options = buildRedisConnectionOptions('redis://redis.internal:6381');

    expect(options).toMatchObject({
      host: 'redis.internal',
      port: 6381,
      maxRetriesPerRequest: null,
    });
    expect(options).not.toHaveProperty('password');
    expect(options).not.toHaveProperty('tls');
  });

  it('defaults to port 6379 and database 0', () => {
    expect(buildRedisConnectionOptions('redis://localhost')).toMatchObject({
      host: 'localhost',
      port: 6379,
    });
  });

  it('carries credentials and the database index', () => {
    expect(
      buildRedisConnectionOptions('redis://app:p%40ss@cache.example.com:6380/2'),
    ).toMatchObject({
      host: 'cache.example.com',
      port: 6380,
      username: 'app',
      password: 'p@ss',
      db: 2,
    });
  });

  it('enables TLS for rediss URLs', () => {
    expect(buildRedisConnectionOptions('rediss://cache.example.com:6380')).toMatchObject({
      host: 'cache.example.com',
      port: 6380,
      tls: {},
    });
  });

  it('strips the brackets from IPv6 hosts', () => {
    expect(buildRedisConnectionOptions('redis://[::1]:6379')).toMatchObject({ host: '::1' });
  });

  it.each(['http://localhost:6379', 'redis://localhost:6379/not-a-number'])('rejects %s', (url) => {
    expect(() => buildRedisConnectionOptions(url)).toThrow();
  });
});
