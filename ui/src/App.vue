<template>
  <div class="min-h-screen bg-gray-950 flex flex-col">
    <NavBar />
    <div class="flex-1">
      <RouterView />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import NavBar from './components/NavBar.vue'
import { useWorkspaceStore } from './stores/workspace'

const workspaceStore = useWorkspaceStore()
onMounted(() => workspaceStore.init())
</script>
