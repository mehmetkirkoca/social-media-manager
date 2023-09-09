const RabbitMQConnector = require('./RabbitMQConnector');

class RabbitMQListener {
  constructor() {
    this.rabbitmqConnector = new RabbitMQConnector();
  }

  async connect() { 
    await this.rabbitmqConnector.connect();
  }

  async consumeFromQueue(queueName, callback) {
    await this.connect();
    try {
      if (!this.rabbitmqConnector.channel) {
        throw new Error('Channel is not initialized. Call connect() first.');
      }

      let result = await this.rabbitmqConnector.channel.assertQueue(queueName, { durable: true });
      console.log('Queue asserted.',result);
  
      this.rabbitmqConnector.channel.consume(queueName, async (msg) => {
        if (msg !== null) {
          const content = msg.content.toString();
          try {
            await callback(content);
            this.rabbitmqConnector.channel.ack(msg);
          } catch (callbackError) {
            console.error('Callback error:', callbackError);
          }
        }
      });
  
      console.log(`Listening for messages on queue "${queueName}"`);
    } catch (error) {
      console.error('Error consuming messages:', error.message);
    }
  }

  async listenToQueue(queueName, callback) {
    try {
      await this.consumeFromQueue(queueName, async (message) => {
        await callback(message);
      });
    } catch (error) {
      console.error('Error while listening:', error.message);
    }
  }
}

module.exports = RabbitMQListener;