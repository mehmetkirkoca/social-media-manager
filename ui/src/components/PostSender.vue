<template>
  <div>
    <textarea v-model="message" id="message"></textarea>
    <button @click="sendMessage">Send Message</button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import axios from 'axios'; // Make sure you have axios installed

const message = ref(''); // Initialize the message data property

const sendMessage = async () => {
  try {
    const response = await axios.post('/api/', {
      message: message.value
    });
    console.log('Message sent:', response.data);
  } catch (error) {
    console.error('Error sending message:', error);
  }
};
</script>

<style scoped>
/* Your component-specific styles */
</style>
