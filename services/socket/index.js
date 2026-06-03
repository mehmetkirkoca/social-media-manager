const socketIO = require('socket.io');
const RabbitMQListener = require('./utils/RabbitMQListener');
const EventEmitter = require('events');
const { createLogger } = require('./utils/logger');

const log = createLogger('socket');
const socketEmitter = new EventEmitter();

const rabbitMQListener = new RabbitMQListener();
rabbitMQListener.listenToQueue('formattedMessages', (messages) => {
  log.info({ action: 'message_received', queue: 'formattedMessages', outcome: 'success' });
  socketEmitter.emit('formattedMessages', messages);
});

const io = socketIO(8084);

io.on('connection', (socket) => {
  log.info({ action: 'client_connect', socketId: socket.id });

  socket.on('disconnect', () => {
    log.info({ action: 'client_disconnect', socketId: socket.id });
  });

  socketEmitter.on('formattedMessages', (messages) => {
    if (socket.connected) {
      socket.send(messages);
    }
  });
});