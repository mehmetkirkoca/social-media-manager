const RabbitMQWrapper = require('./RabbitMQWrapper');

class RabbitMQListener {
  constructor() {
    this.rabbitmq = new RabbitMQWrapper();
  }

  async listenToQueue(queueName, callback) {
    try {
      await this.rabbitmq.consumeFromQueue(queueName, async (message) => {
        await callback(message);
      });
    } catch (error) {
      console.error('Error while listening:', error.message);
    }
  }
}

module.exports = RabbitMQListener;