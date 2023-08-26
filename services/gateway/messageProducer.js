const amqp = require('amqplib');

class RabbitMQWrapper {
  constructor(connectionURL) {
    this.connectionURL = connectionURL;
    this.connection = null;
    this.channel = null;
  }

  async connect() {
    try {
      this.connection = await amqp.connect(this.connectionURL);
      this.channel = await this.connection.createChannel();
      console.log('Connected to RabbitMQ');
    } catch (error) {
      console.error('Error connecting to RabbitMQ:', error);
    }
  }

  async publishToQueue(queueName, message) {
    try {
      await this.channel.assertQueue(queueName, { durable: true });
      this.channel.sendToQueue(queueName, Buffer.from(message));
      console.log(`Published to ${queueName}: ${message}`);
    } catch (error) {
      console.error(`Error publishing to ${queueName}:`, error);
    }
  }
}

module.exports = RabbitMQWrapper;
