import { createRouter, createWebHistory } from '@ionic/vue-router'

const routes = [
  {
    path: '/',
    redirect: '/roll-call',
  },
  {
    path: '/roll-call',
    name: 'RollCall',
    component: () => import('@/views/RollCall.vue'),
  },
  {
    path: '/weekly-entry',
    name: 'WeeklyEntry',
    component: () => import('@/views/WeeklyEntry.vue'),
  },
  {
    path: '/weekly-entry/:id',
    name: 'WeeklyEntryDetail',
    props: true,
    component: () => import('@/views/WeeklyEntryDetail.vue'),
  },
  {
    path: '/profile',
    name: 'Profile',
    component: () => import('@/views/Profile.vue'),
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/Login.vue'),
  },
]

const router = createRouter({
  history: createWebHistory('/flexitime'),
  routes,
})

// Navigation guard for authentication
router.beforeEach((to, from, next) => {
  const isGuest = window.is_guest

  if (to.name !== 'Login' && isGuest) {
    next({ name: 'Login' })
  } else if (to.name === 'Login' && !isGuest) {
    next({ name: 'RollCall' })
  } else {
    next()
  }
})

export default router
