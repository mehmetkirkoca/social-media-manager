import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import axios from 'axios'

export interface Workspace {
  _id: string
  name: string
  createdAt: string
}

const STORAGE_KEY = 'activeWorkspaceId'

export const useWorkspaceStore = defineStore('workspace', () => {
  const workspaces = ref<Workspace[]>([])
  const activeWorkspaceId = ref<string>(localStorage.getItem(STORAGE_KEY) || 'default')
  const loading = ref(false)
  const error = ref('')

  const activeWorkspace = computed(
    () => workspaces.value.find((w) => w._id === activeWorkspaceId.value) ?? null
  )

  function applyHeader(id: string) {
    axios.defaults.headers.common['X-Workspace-Id'] = id
  }

  async function init() {
    applyHeader(activeWorkspaceId.value)
    try {
      const res = await axios.get('/api/workspaces')
      workspaces.value = res.data.workspaces ?? []
      // If the stored workspace no longer exists, fall back to first available
      if (workspaces.value.length && !workspaces.value.find((w) => w._id === activeWorkspaceId.value)) {
        await setActive(workspaces.value[0]._id)
      }
    } catch {
      // Non-fatal — default workspace still works even without the list
    }
  }

  async function setActive(id: string) {
    activeWorkspaceId.value = id
    localStorage.setItem(STORAGE_KEY, id)
    applyHeader(id)
  }

  async function create(name: string): Promise<Workspace> {
    const res = await axios.post('/api/workspaces', { name })
    const ws: Workspace = res.data
    workspaces.value.push(ws)
    return ws
  }

  async function rename(id: string, name: string) {
    await axios.put(`/api/workspaces/${id}`, { name })
    const ws = workspaces.value.find((w) => w._id === id)
    if (ws) ws.name = name
  }

  async function remove(id: string) {
    await axios.delete(`/api/workspaces/${id}`)
    workspaces.value = workspaces.value.filter((w) => w._id !== id)
    if (activeWorkspaceId.value === id && workspaces.value.length) {
      await setActive(workspaces.value[0]._id)
    }
  }

  return { workspaces, activeWorkspaceId, activeWorkspace, loading, error, init, setActive, create, rename, remove }
})
