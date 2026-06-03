require('dotenv').config();
const app = require('./server.js');
const { connect } = require('./utils/MongoDBConnector');
const { warnIfNoKey } = require('./utils/crypto');

async function start() {
  warnIfNoKey('gateway');
  await connect();
  await app.listen({ port: 8084, host: '0.0.0.0' });
  app.log.info({ action: 'service_start', port: 8084, outcome: 'success' }, 'Gateway API running');
}

start().catch((err) => {
  app.log.error({ action: 'service_start', outcome: 'failure', err: err.message }, 'Gateway failed to start');
  process.exit(1);
});
