import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor() {}

  /**
   * Simple health check - returns OK status
   */
  async checkHealth(): Promise<{ status: string }> {
    this.logger.debug('Health check requested');
    return { status: 'ok' };
  }
}
