const RabbitMQListener = require('./utils/RabbitMQListener');
const rabbitmqListener = new RabbitMQListener();

(async () => {
  await rabbitmqListener.listenToQueue('linkedin', (message) => {
    console.log('Received message:', message);
  });
})();
