export const ROUTES = {
  LORE: 'LORE',
  RECOMMENDATION: 'RECOMMENDATION',
  HARDWARE: 'HARDWARE',
  GENERAL_CHAT: 'GENERAL_CHAT',
} as const;

export const FALLBACK_RESULT = {
  route: 'GENERAL_CHAT',
  confidence: 0,
} as const;