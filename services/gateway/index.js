const fastify = require('fastify')();

fastify.get('/', async (request, reply) => {
  reply.send({status: "Api Gateway Runnning"});
});

fastify.listen(8084, 'gateway', (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Gateway api service workin on ${address}`);
});
