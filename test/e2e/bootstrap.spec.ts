import { Body, Controller, INestApplication, Module, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { IsEmail, IsString } from 'class-validator';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/common/app-setup';

class ProbeDto {
  @IsString()
  name!: string;

  @IsEmail()
  email!: string;
}

@Controller('probe')
class ProbeController {
  @Post()
  create(@Body() body: ProbeDto): { name: string } {
    return { name: body.name };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

/**
 * Exercises the production pipeline (prefix, pipe, filter, envelope, request id)
 * from configureApp. The probe controller lives only in tests so no fake product
 * endpoints ship in src/.
 */
describe('app bootstrap (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, ProbeModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it('wraps a valid response in the data envelope', async () => {
    const res = await request(server).post('/api/v1/probe').send({ name: 'ok', email: 'a@b.co' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ data: { name: 'ok' } });
  });

  it('returns the standard 400 error format for an invalid body', async () => {
    const res = await request(server).post('/api/v1/probe').send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.message).toBe('Validation failed');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        { field: 'name', message: 'name must be a string' },
        { field: 'email', message: 'email must be an email' },
      ]),
    );
    expect(res.body.error).not.toHaveProperty('stack');
    expect(JSON.stringify(res.body)).not.toContain('node_modules');
  });

  it('rejects unknown body properties', async () => {
    const res = await request(server)
      .post('/api/v1/probe')
      .send({ name: 'x', email: 'a@b.co', extra: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'extra' })]),
    );
  });

  it('returns the 404 error envelope for unknown routes', async () => {
    const res = await request(server).get('/api/v1/nope');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body).not.toHaveProperty('data');
  });

  it('GET /api/v1/health returns the data envelope with live checks', async () => {
    const res = await request(server).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.checks).toEqual({ database: 'ok', redis: 'ok' });
    expect(Number.isNaN(Date.parse(res.body.data.timestamp))).toBe(false);
  });

  it('echoes a safe X-Request-Id and issues a UUID otherwise', async () => {
    const echoed = await request(server).get('/api/v1/health').set('X-Request-Id', 'e2e-abc_123');
    expect(echoed.headers['x-request-id']).toBe('e2e-abc_123');

    const issued = await request(server).get('/api/v1/health');
    expect(issued.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
