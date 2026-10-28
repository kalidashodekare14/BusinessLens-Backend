import { Test } from '@nestjs/testing';
import { WorkerRuntimeService } from '../../src/queues/worker-runtime.service';
import { WorkerModule } from '../../src/worker.module';

/**
 * The worker graph must never load a module that owns an HTTP controller: its
 * guards need JwtService and there is no HTTP pipeline in this process. This
 * resolves every provider (DI runs at compile time) without starting BullMQ's
 * lifecycle hooks, so it catches the regression cheaply.
 */
describe('worker module bootstrap', () => {
  it('resolves every provider without HTTP-only dependencies', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();

    try {
      expect(moduleRef.get(WorkerRuntimeService)).toBeDefined();
    } finally {
      await moduleRef.close();
    }
  });
});
