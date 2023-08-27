const RabbitMQListener = require('./utils/RabbitMQListener');
const rabbitmqListener = new RabbitMQListener();

(async () => {
  await rabbitmqListener.listenToQueue('twitter', (message) => {
    console.log('Received message:', message);
  });
})();
