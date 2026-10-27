import type { ConnectionOptions } from 'bullmq';

const DEFAULT_REDIS_PORT = 6379;

/**
 * BullMQ owns the Redis connections it creates (Queue, Worker), so both the API
 * and the worker build them from the same validated URL instead of sharing an
 * ioredis instance. `maxRetriesPerRequest: null` is required for the blocking
 * connections BullMQ workers use; without it, commands fail after one retry.
 */
export function buildRedisConnectionOptions(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error('REDIS_URL must use the redis:// or rediss:// scheme');
  }

  const port = url.port ? Number(url.port) : DEFAULT_REDIS_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('REDIS_URL contains an invalid port');
  }

  const database = url.pathname.replace(/^\//, '');
  if (database !== '' && !/^\d+$/.test(database)) {
    throw new Error('REDIS_URL contains an invalid database number');
  }

  return {
    // URL keeps IPv6 hosts bracketed; ioredis expects the bare address.
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port,
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(database ? { db: Number(database) } : {}),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}
