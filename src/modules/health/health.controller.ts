import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthReport, HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthReport> {
    const { report, healthy } = await this.health.check();
    if (!healthy) {
      // 200 when both checks pass, 503 otherwise; body stays in the data envelope.
      res.statusCode = 503;
    }
    return report;
  }
}
