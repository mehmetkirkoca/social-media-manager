const RabbitMQListener = require('./utils/RabbitMQListener');
const rabbitMQListener = new RabbitMQListener();

(async () => {
  await rabbitMQListener.listenToQueue('linkedin', (message) => {
    console.log('Received message:', message);
  });
})();
