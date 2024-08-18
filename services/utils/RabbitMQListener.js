const RabbitMQConnector = require('./RabbitMQConnector');

class RabbitMQListener {
  constructor() {
    this.rabbitmqConnector = new RabbitMQConnector();
  }

  async connect() { 
    await this.rabbitmqConnector.connect();
  }  
  
  async disconnect() { 
    await this.rabbitmqConnector.disconnect();
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
      return true;
    } catch (error) {
      console.error('Error consuming messages:', error.message);
      return false;
    }
  }

  async listenToQueue(queueName, callback) {
    try {
      let connected = await this.consumeFromQueue(queueName, async (message) => {
        await callback(message);
      });
      // retry with timer if failed
      if(!connected) {  
        setTimeout(() => {
          this.listenToQueue(queueName, callback);
        }, 5000);
      }

    } catch (error) {
      console.error('Error while listening:', error.message);
    }
  }
}

module.exports = RabbitMQListener;