const amqp = require('amqplib');

class RabbitMQWrapper {
  constructor() {
    this.connection = null;
    this.channel = null;
  }

  async connect() {
    try {
      this.connection = await amqp.connect('amqp://username:password@messageBroker');
      this.channel = await this.connection.createChannel();
      console.log('Connected to RabbitMQ');
    } catch (error) {
      console.error('Error connecting to RabbitMQ:', error);
    }
  }

  async consumeFromQueue(queueName, callback) {
    await this.connect();
    try {
      if (!this.channel) {
        throw new Error('Channel is not initialized. Call connect() first.');
      }

      let result = await this.channel.assertQueue(queueName, { durable: true });
      console.log('Queue asserted.',result);
  
      this.channel.consume(queueName, async (msg) => {
        if (msg !== null) {
          const content = msg.content.toString();
          try {
            await callback(content);
            this.channel.ack(msg);
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
}

module.exports = RabbitMQWrapper;
