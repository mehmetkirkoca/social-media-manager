const fastify = require('fastify')();
const sendTestMessage = require('./utils');

fastify.post('/', async (request, reply) => {
  try {
    sendTestMessage(request.body.message);
    reply.send({ status: 'Message Send' });
  } catch (error) {
    console.error('Error handling POST request:', error);
    reply.status(500).send({ error: 'Internal Server Error' });
  }
});

fastify.listen(8084, 'gateway', (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Gateway api service workin on ${address}`);
});
