import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RouteRequestDto, MessageDto } from './route-request.dto';

describe('RouteRequestDto', () => {
  describe('validation', () => {
    it('should fail when userMessage is empty string', async () => {
      const dto = plainToInstance(RouteRequestDto, {
        userMessage: '',
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('userMessage');
      expect(errors[0].constraints).toHaveProperty('isNotEmpty');
    });

    it('should fail when userMessage field is missing', async () => {
      const dto = plainToInstance(RouteRequestDto, {});

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'userMessage')).toBe(true);
    });

    it('should pass when userMessage is valid and conversationHistory is missing', async () => {
      const dto = plainToInstance(RouteRequestDto, {
        userMessage: 'hello',
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should pass when userMessage is valid and conversationHistory is an array', async () => {
      const dto = plainToInstance(RouteRequestDto, {
        userMessage: 'hello',
        conversationHistory: [
          {
            role: 'user',
            content: 'hi',
          },
        ],
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should fail when conversationHistory has invalid role', async () => {
      const dto = plainToInstance(RouteRequestDto, {
        userMessage: 'hello',
        conversationHistory: [
          {
            role: 'invalid',
            content: 'hi',
          },
        ],
      });

      const errors = await validate(dto, { skipMissingProperties: false });
      const historyErrors = errors.find(
        (e) => e.property === 'conversationHistory',
      );
      expect(historyErrors).toBeDefined();
    });

    it('should fail when conversationHistory message has empty content', async () => {
      const dto = plainToInstance(RouteRequestDto, {
        userMessage: 'hello',
        conversationHistory: [
          {
            role: 'user',
            content: '',
          },
        ],
      });

      const errors = await validate(dto, { skipMissingProperties: false });
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
