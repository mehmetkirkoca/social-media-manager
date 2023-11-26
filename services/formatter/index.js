const RabbitMQListener = require('./utils/RabbitMQListener');
const rabbitMQListener = new RabbitMQListener();

const RabbitMQProducer = require('./utils/RabbitMQProducer');
let rabbitMQProducer = new RabbitMQProducer();

async function formatForTwitter(message) {
  return "message formatted for twitter: " + message;
}

async function formatForLinkedin(message) {
  return "message formatted for linkedin: " + message;
}

async function formatMessage(message) {
  if (message === null || message === undefined) {
    return;
  }

  let messages = {
    twitter : '',
    linkedin: ''
  };

  try {
    // Use Promise.all to concurrently format the message for Twitter and LinkedIn
    [messages.twitter, messages.linkedin] = await Promise.all([
      formatForTwitter(message).catch(error => {
        console.error('Error formatting for Twitter:', error);
        return null;
      }),
      formatForLinkedin(message).catch(error => {
        console.error('Error formatting for LinkedIn:', error);
        return null;
      })
    ]);
    
  } catch (error) {
    // Handle any errors that occur during the formatting process
    console.error('Error formatting message:', error);
  }

  try {
    rabbitMQProducer.sendMessage('formattedMessages', JSON.stringify(messages));
  } catch (error) {
    console.error('Error sending message:', error);
  }
}

(async () => {
  await rabbitMQListener.listenToQueue('formatter', (message) => {
    console.log('Received message:', message);
    formatMessage(message);
  });
})();
