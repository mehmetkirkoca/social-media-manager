const RabbitMQListener = require('./utils/RabbitMQListener');
const { createLogger } = require('./utils/logger');

const log = createLogger('linkedin');
const rabbitMQListener = new RabbitMQListener();

(async () => {
  await rabbitMQListener.listenToQueue('linkedin', (message) => {
    log.info({ action: 'message_received', outcome: 'success' }, message);
  });
})();
