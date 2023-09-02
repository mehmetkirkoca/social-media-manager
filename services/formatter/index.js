const RabbitMQListener = require('./utils/RabbitMQListener');
const rabbitmqListener = new RabbitMQListener();

const RabbitMQProducer = require('./utils/RabbitMQProducer');
let rabbitMQProducer = new RabbitMQProducer();

async function formatForTwitter(message) {
  return "message formatted for twitter: " + message;
}

async function formatForLinkedin(message) {
  return "message formatted for linkedin: " + message;
}

async function formatMessage(message) {
  let messages = {
    twitter : await formatForTwitter(message),
    linkedin : await formatForLinkedin(message),
  }
  rabbitMQProducer.sendMessage('formattedMessages', JSON.stringify(messages));
}

(async () => {
  await rabbitmqListener.listenToQueue('formatter', (message) => {
    console.log('Received message:', message);
    formatMessage(message);
  });
})();
