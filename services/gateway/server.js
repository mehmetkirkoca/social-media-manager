const app = require('fastify')();
const RabbitMQProducer = require('./utils/RabbitMQProducer');
let rabbitMQProducer = new RabbitMQProducer();

app.post('/', async (request, reply) => {
  try {
    await rabbitMQProducer.sendMessage('formatter', request.body.message);
    reply.send({ status: 'ok' });
  } catch (error) {
    console.error('Error handling POST request:', error);
    reply.status(500).send({ error: 'Internal Server Error' });
  }
});

module.exports = app;