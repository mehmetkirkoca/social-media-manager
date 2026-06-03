import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior(to) {
    if (to.hash) {
      return { el: to.hash, behavior: 'smooth', top: 20 }
    }
    return { top: 0 }
  },
  routes: [
    {
      path: '/',
      redirect: '/dashboard',
    },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('../views/Dashboard.vue'),
    },
    {
      path: '/compose',
      name: 'compose',
      component: () => import('../views/Compose.vue'),
    },
    {
      path: '/scheduler',
      name: 'scheduler',
      component: () => import('../views/Scheduler.vue'),
    },
    {
      path: '/media',
      name: 'media',
      component: () => import('../views/Media.vue'),
    },
    {
      path: '/analytics',
      name: 'analytics',
      component: () => import('../views/Analytics.vue'),
    },
    {
      path: '/competitors',
      name: 'competitors',
      component: () => import('../views/Competitors.vue'),
    },
    {
      path: '/calendar-plan',
      name: 'calendarPlan',
      component: () => import('../views/CalendarPlan.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/Settings.vue'),
    },
    {
      path: '/global-settings',
      name: 'globalSettings',
      component: () => import('../views/GlobalSettings.vue'),
    },
  ],
})

export default router
