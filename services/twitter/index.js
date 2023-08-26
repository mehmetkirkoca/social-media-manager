const RabbitMQWrapper = require('./messageConsumer');

class RabbitMQListener {
  constructor() {
    this.rabbitmq = new RabbitMQWrapper();
  }

  async listenToQueue(queueName, callback) {
    try {
      await this.rabbitmq.consumeFromQueue(queueName, async (message) => {
        console.log('Message came', {message})
        // Process the message
        await callback(message);
      });
    } catch (error) {
      console.error('Error while listening:', error.message);
    }
  }
}

// Example usage
const rabbitmqListener = new RabbitMQListener();

(async () => {
  await rabbitmqListener.listenToQueue('myQueue', (message) => {
    console.log('Received message:', message);
    // Process the received message
  });
})();
