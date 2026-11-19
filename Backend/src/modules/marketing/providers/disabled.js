import { ApiError } from '../../../utils/ApiError.js';

const notConfigured = () => {
  throw new ApiError(503, 'No AI provider is configured', { code: 'AI_PROVIDER_NOT_CONFIGURED' });
};

/// Default in production until a real provider is wired in.
export const disabledProvider = Object.freeze({
  name: 'disabled',
  configured: false,
  model: '',
  embeddingModel: '',
  generateText: async () => notConfigured(),
  embed: async () => notConfigured(),
});
