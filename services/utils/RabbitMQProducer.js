const RabbitMQConnector = require('./RabbitMQConnector');

class RabbitMQProducer {
  
  constructor() {
    this.connect();
  }

  async connect() {
    this.rabbitmqConnector = new RabbitMQConnector();
    await this.rabbitmqConnector.connect();
  }

  async disconnect() { 
    await this.rabbitmqConnector.disconnect();
  }

  async publishToQueue(queueName, message) {
    if(this.rabbitmqConnector.channel === null) {
      await this.connect();
    }
    try {
      await this.rabbitmqConnector.channel.assertQueue(queueName, { durable: true });
      this.rabbitmqConnector.channel.sendToQueue(queueName, Buffer.from(message));
      console.log(`Published to ${queueName}: ${message}`);
    } catch (error) {
      console.error(`Error publishing to ${queueName}:`, error);
    }
  }
  
  async sendMessage(queueName, message) {
    try {
      await this.publishToQueue(queueName, message);
    } catch (error) {
      console.error('Error sending message:', error.message);
    }
  }

}

module.exports = RabbitMQProducer;
