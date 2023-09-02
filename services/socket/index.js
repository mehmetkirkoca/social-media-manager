const socketIO = require('socket.io');
const RabbitMQListener = require('./utils/RabbitMQListener');
const EventEmitter = require('events');
const socketEmitter = new EventEmitter();

const rabbitmqListener = new RabbitMQListener();
rabbitmqListener.listenToQueue('formattedMessages', (messages) => {
  console.log('Received formatted Messages:', messages);
  socketEmitter.emit('formattedMessages', messages);
});

const io = socketIO(8084);

io.on('connection', (socket) => {
  console.log('User Connected ' + socket.id);

  socket.on('disconnect', () => {
    console.log('User Disconnected: ' + socket.id);
  });

  socketEmitter.on('formattedMessages', (messages) => {
    if (socket.connected) {
      socket.send(messages);
    }
  });
});