import { applyDecorators, type Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { DataEnvelope, ErrorEnvelopeDto, PaginationMetaDto } from './models';

interface DataResponseOptions {
  status?: number;
  description?: string;
  isArray?: boolean;
}

/**
 * Documents the §12 single-resource envelope: `{ data: Model }`.
 * Keeping this in one place stops controllers from drifting to a bare model.
 */
export function ApiDataResponse(
  model: Type<unknown>,
  options: DataResponseOptions = {},
): MethodDecorator & ClassDecorator {
  const { status = 200, description = 'Successful response', isArray = false } = options;
  const data = isArray
    ? { type: 'array', items: { $ref: getSchemaPath(model) } }
    : { $ref: getSchemaPath(model) };

  return applyDecorators(
    ApiExtraModels(model, DataEnvelope),
    ApiResponse({
      status,
      description,
      schema: {
        allOf: [{ $ref: getSchemaPath(DataEnvelope) }, { properties: { data } }],
      },
    }),
  );
}

/** Documents the §12 list envelope: `{ data: Model[], meta: { page, pageSize, total } }`. */
export function ApiPaginatedResponse(
  model: Type<unknown>,
  options: Omit<DataResponseOptions, 'isArray'> = {},
): MethodDecorator & ClassDecorator {
  const { status = 200, description = 'Successful response' } = options;

  return applyDecorators(
    ApiExtraModels(model, DataEnvelope, PaginationMetaDto),
    ApiResponse({
      status,
      description,
      schema: {
        allOf: [
          { $ref: getSchemaPath(DataEnvelope) },
          {
            properties: {
              data: { type: 'array', items: { $ref: getSchemaPath(model) } },
              meta: { $ref: getSchemaPath(PaginationMetaDto) },
            },
          },
        ],
      },
    }),
  );
}

const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: 'Validation failed',
  401: 'Authentication required or invalid credentials',
  403: 'The member role is not allowed to perform this action',
  404: 'Not found, or the caller is not a member of the organization',
  409: 'The resource is in a conflicting state',
  413: 'The uploaded file exceeds the 5 MB limit',
  422: 'The submitted data is not processable',
  429: 'Rate limit exceeded',
  500: 'Unexpected server error',
  503: 'A required dependency is unavailable',
};

/** Adds the standard `{ error: { code, message, details } }` schema for each status. */
export function ApiErrorResponses(...statuses: number[]): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiExtraModels(ErrorEnvelopeDto),
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: ERROR_DESCRIPTIONS[status] ?? 'Error',
        schema: { $ref: getSchemaPath(ErrorEnvelopeDto) },
      }),
    ),
  );
}
