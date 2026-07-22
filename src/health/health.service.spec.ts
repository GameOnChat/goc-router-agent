import { Test, TestingModule } from '@nestjs/testing';
import { HealthService } from './health.service';

describe('HealthService', () => {
  let service: HealthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [HealthService],
    }).compile();

    service = module.get<HealthService>(HealthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkHealth', () => {
    it('should return status ok', async () => {
      const result = await service.checkHealth();
      expect(result).toEqual({ status: 'ok' });
    });

    it('should have status property as string', async () => {
      const result = await service.checkHealth();
      expect(typeof result.status).toBe('string');
    });

    it('should return consistent results on multiple calls', async () => {
      const result1 = await service.checkHealth();
      const result2 = await service.checkHealth();
      expect(result1).toEqual(result2);
    });
  });
});
