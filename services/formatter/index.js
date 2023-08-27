const RabbitMQListener = require('./utils/RabbitMQListener');
const rabbitmqListener = new RabbitMQListener();

const RabbitMQProducer = require('./utils/RabbitMQProducer');
let rabbitMQProducer = new RabbitMQProducer();

async function formatForTwitter(message) {
  await rabbitMQProducer.sendMessage('twitter', "message formatted for twitter: " + message);
}

async function formatForLinkedin(message) {
  await rabbitMQProducer.sendMessage('linkedin', "message formatted for linkedin: " + message);
}

(async () => {
  await rabbitmqListener.listenToQueue('formatter', (message) => {
    console.log('Received message:', message);
    formatForTwitter(message);
    formatForLinkedin(message);
  });
})();
