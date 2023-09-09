const amqp = require('amqplib');

class RabbitMQConnector {
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

  async disconnect() {
    try {
      if (this.channel) {
        await this.channel.close();
        console.log('Channel closed');
      }

      if (this.connection) {
        await this.connection.close();
        console.log('Connection closed');
      }
    } catch (error) {
      console.error('Error disconnecting from RabbitMQ:', error);
      throw error;
    }
  }
}

module.exports = RabbitMQConnector;
