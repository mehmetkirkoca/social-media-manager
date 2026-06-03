const { MongoClient } = require('mongodb');
const { createLogger } = require('./logger');

const log = createLogger('mongodb');

const MONGODB_URL = process.env.MONGODB_URL || 'mongodb://mongodb:27017';
const DB_NAME = process.env.MONGODB_DB || 'socialmedia';

let client = null;
let db = null;

async function connect() {
  if (db) return db;

  client = new MongoClient(MONGODB_URL);
  await client.connect();
  db = client.db(DB_NAME);
  log.info({ action: 'connect', outcome: 'success', database: DB_NAME });
  return db;
}

async function getDb() {
  if (!db) await connect();
  return db;
}

async function disconnect() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    log.info({ action: 'disconnect', outcome: 'success' });
  }
}

module.exports = { connect, getDb, disconnect };
