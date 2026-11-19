/// Public surface of the marketing / AI module.
export { marketingRouter } from './routes/index.js';
export { startMarketingJobs, stopMarketingJobs, runPublishDue } from './services/jobs.js';
export { registerAiProvider, generateText, embed, providerStatus } from './providers/index.js';
export { registerPublisher, publisherStatus } from './publishers/index.js';
export { answerQuestion, recommendProducts, syncProducts } from './services/kbService.js';
export { whatsappAutoReply } from './services/chatbotBridge.js';
export { VIEW_PERMISSION, REVIEW_PERMISSION } from './constants.js';
