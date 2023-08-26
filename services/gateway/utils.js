const messageProducer = require('./messageProducer');
let rabbitmq = new messageProducer('amqp://username:password@messageBroker');

(async () => {
  await rabbitmq.connect();
})();


async function sendMessage(queueName, message) {
  try {
    await rabbitmq.publishToQueue(queueName, message);
  } catch (error) {
    console.error('Error sending message:', error.message);
  }
}

async function sendTestMessage(message) {
    await sendMessage('myQueue', message);
}

module.exports = sendTestMessage;