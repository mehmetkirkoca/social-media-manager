const amqp = require('amqplib');
const { createLogger } = require('./logger');

const log = createLogger('rabbitmq');

class RabbitMQConnector {
  constructor() {
    this.connection = null;
    this.channel = null;
  }

  async connect() {
    try {
      this.connection = await amqp.connect('amqp://username:password@messageBroker');
      this.channel = await this.connection.createChannel();
      log.info({ action: 'connect', outcome: 'success' });
    } catch (error) {
      log.error({ action: 'connect', outcome: 'failure', err: error.message });
    }
  }

  async disconnect() {
    try {
      if (this.channel) {
        await this.channel.close();
        log.info({ action: 'channel_close', outcome: 'success' });
      }

      if (this.connection) {
        await this.connection.close();
        log.info({ action: 'disconnect', outcome: 'success' });
      }
    } catch (error) {
      log.error({ action: 'disconnect', outcome: 'failure', err: error.message });
      throw error;
    }
  }
}

module.exports = RabbitMQConnector;
