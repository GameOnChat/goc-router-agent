import { RouteResponseDto } from './route-response.dto';

describe('RouteResponseDto', () => {
  it('should construct with a route and confidence', () => {
    const dto = new RouteResponseDto();
    dto.route = 'LORE';
    dto.confidence = 0.92;

    expect(dto.route).toBe('LORE');
    expect(dto.confidence).toBe(0.92);
  });

  it('should allow a plain object literal matching the shape', () => {
    const dto: RouteResponseDto = { route: 'GENERAL_CHAT', confidence: 0 };

    expect(dto.route).toBe('GENERAL_CHAT');
    expect(dto.confidence).toBe(0);
  });
});
