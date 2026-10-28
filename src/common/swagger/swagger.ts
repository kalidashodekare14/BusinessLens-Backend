import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { ALL_MODELS } from './models';

const DESCRIPTION = [
  'BusinessLens API v1.',
  '',
  'Every success response uses `{ "data": ... }` and lists add `meta: { page, pageSize, total }`.',
  'Errors use `{ "error": { "code": "UPPER_SNAKE", "message": "...", "details": [] } }`.',
  'Money values are strings, timestamps are ISO 8601 UTC, and tenant routes live under',
  '`/api/v1/organizations/:organizationId/...` (a non-member receives 404).',
].join('\n');

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('BusinessLens API')
    .setDescription(DESCRIPTION)
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
    .addCookieAuth(
      'bl_refresh',
      { type: 'apiKey', in: 'cookie', name: 'bl_refresh' },
      'refresh-cookie',
    )
    .build();

  return SwaggerModule.createDocument(app, config, { extraModels: ALL_MODELS });
}

/** Serves the UI at `/api/docs` and the JSON at `/api/docs-json` (independent of /api/v1). */
export function setupSwagger(app: INestApplication): void {
  const document = buildOpenApiDocument(app);
  SwaggerModule.setup('api/docs', app, document, { customSiteTitle: 'BusinessLens API' });
}
