import os from 'node:os';
import { HttpException } from '@nestjs/common';
import type { AuditService } from '../../../../src/modules/audit/audit.service';
import { DemoDataService } from '../../../../src/modules/demo/demo.service';
import type { ImportsService } from '../../../../src/modules/imports/imports.service';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

const SUGGESTED_PRODUCTS = { name: 'Name', sku: 'SKU', price: 'Price' };
const SUGGESTED_ORDERS = { orderId: 'Order ID', orderedAt: 'Order Date', productName: 'Product' };

function uploadView(
  id: string,
  type: 'PRODUCTS' | 'ORDERS',
  suggestedMapping: Record<string, string | null>,
) {
  return {
    id,
    type,
    status: 'UPLOADED' as const,
    originalFileName: `${type.toLowerCase()}.csv`,
    detectedHeaders: [],
    suggestedMapping,
    createdAt: new Date('2026-10-27T00:00:00.000Z'),
  };
}

describe('DemoDataService (T6.2)', () => {
  let imports: {
    upload: jest.Mock;
    updateMapping: jest.Mock;
    confirm: jest.Mock;
  };
  let audit: { record: jest.Mock };
  let service: DemoDataService;

  beforeEach(() => {
    imports = {
      upload: jest.fn(),
      updateMapping: jest.fn(),
      confirm: jest.fn(),
    };
    audit = { record: jest.fn() };
    service = new DemoDataService(
      imports as unknown as ImportsService,
      audit as unknown as AuditService,
    );
  });

  function queueHappyPath(): void {
    imports.upload
      .mockResolvedValueOnce(uploadView('import-products', 'PRODUCTS', SUGGESTED_PRODUCTS))
      .mockResolvedValueOnce(uploadView('import-orders', 'ORDERS', SUGGESTED_ORDERS));
    imports.updateMapping
      .mockResolvedValueOnce({ id: 'import-products', status: 'MAPPED' })
      .mockResolvedValueOnce({ id: 'import-orders', status: 'MAPPED' });
    imports.confirm
      .mockResolvedValueOnce({ id: 'import-products', type: 'PRODUCTS', status: 'PROCESSING' })
      .mockResolvedValueOnce({ id: 'import-orders', type: 'ORDERS', status: 'PROCESSING' });
  }

  it('runs upload → mapping → confirm for both sample files, in order', async () => {
    queueHappyPath();

    const result = await service.load(ORG_ID, USER_ID);

    expect(imports.upload).toHaveBeenCalledTimes(2);
    expect(imports.upload.mock.calls.map((call) => call[2])).toEqual(['PRODUCTS', 'ORDERS']);
    const productFile = imports.upload.mock.calls[0][3] as Express.Multer.File;
    const orderFile = imports.upload.mock.calls[1][3] as Express.Multer.File;
    expect(productFile.originalname).toBe('products.csv');
    expect(orderFile.originalname).toBe('orders.csv');
    expect(productFile.buffer.byteLength).toBeGreaterThan(0);
    expect(orderFile.buffer.byteLength).toBeGreaterThan(0);

    // The suggestion is validated through the normal mapping path, never trusted directly.
    expect(imports.updateMapping).toHaveBeenNthCalledWith(
      1,
      ORG_ID,
      'import-products',
      SUGGESTED_PRODUCTS,
    );
    expect(imports.updateMapping).toHaveBeenNthCalledWith(
      2,
      ORG_ID,
      'import-orders',
      SUGGESTED_ORDERS,
    );
    expect(imports.confirm).toHaveBeenNthCalledWith(1, ORG_ID, USER_ID, 'import-products');
    expect(imports.confirm).toHaveBeenNthCalledWith(2, ORG_ID, USER_ID, 'import-orders');

    expect(result).toEqual({
      status: 'PROCESSING',
      imports: [
        { id: 'import-products', type: 'PRODUCTS', status: 'PROCESSING' },
        { id: 'import-orders', type: 'ORDERS', status: 'PROCESSING' },
      ],
    });
  });

  it('records the demo.data_loaded audit event with the created import ids', async () => {
    queueHappyPath();

    await service.load(ORG_ID, USER_ID);

    expect(audit.record).toHaveBeenCalledWith({
      action: 'demo.data_loaded',
      actorId: USER_ID,
      organizationId: ORG_ID,
      metadata: { importIds: ['import-products', 'import-orders'] },
    });
  });

  it('does not record demo.data_loaded when queuing fails', async () => {
    imports.upload.mockResolvedValue(uploadView('import-products', 'PRODUCTS', SUGGESTED_PRODUCTS));
    imports.updateMapping.mockResolvedValue({ id: 'import-products', status: 'MAPPED' });
    imports.confirm.mockRejectedValue(
      new HttpException(
        {
          code: 'IMPORT_QUEUE_UNAVAILABLE',
          message: 'The import could not be queued.',
          details: [],
        },
        503,
      ),
    );

    await expect(service.load(ORG_ID, USER_ID)).rejects.toMatchObject({ status: 503 });
    expect(audit.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'demo.data_loaded' }),
    );
  });

  it('fails with DEMO_DATA_UNAVAILABLE when the sample dataset cannot be read', async () => {
    const originalCwd = process.cwd();
    // The temp dir has no sample-data folder; restored in finally so the rest of
    // this worker's test files keep the real working directory.
    process.chdir(os.tmpdir());

    try {
      await expect(service.load(ORG_ID, USER_ID)).rejects.toMatchObject({ status: 500 });
      expect(imports.upload).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    } finally {
      process.chdir(originalCwd);
    }
  });
});
