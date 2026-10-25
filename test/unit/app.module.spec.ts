import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';

describe('AppModule', () => {
  it('compiles as an empty application shell', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    expect(moduleRef).toBeDefined();
  });
});
