<template>
  <div class="container mx-auto mt-4 p-4">
    <div class="grid grid-cols-1 gap-4">
      <label for="message" class="block font-medium mb-2">Your Post:</label>
      <textarea class="textarea-input" v-model="message" id="message" placeholder="Write your message here"></textarea>
      <button class="blueBtn" @click="sendMessage">Post Your Message</button>
    </div>
    <h2 class="m-3 text-lg">Formatted Posts</h2>
    <div class="grid grid-cols-2 gap-4 m-4 border-y-4">
      <div class="p-4">
        <label for="twitter" class="block font-medium mb-2">Twitter Post:</label>
        <textarea class="textarea-input" v-model="twitter" id="twitter" placeholder="Compose your tweet"></textarea>
        <button class="blueBtn">Post to Twitter</button>
      </div>
      <div class="p-4">
        <label for="linkedin" class="block font-medium mb-2">LinkedIn Post:</label>
        <textarea class="textarea-input" v-model="linkedin" id="linkedin" placeholder="Write your LinkedIn post"></textarea>
        <button class="blueBtn">Post to LinkedIn</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import axios from 'axios';

const message = ref('');
const twitter = ref('');
const linkedin = ref('');

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
.textarea-input {
  @apply p-2 border border-gray-300 rounded-md focus:outline-none focus:border-blue-500;
}
.blueBtn{
  @apply bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 focus:outline-none
}
</style>