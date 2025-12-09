<template>
  <ion-page>
    <ion-content class="ion-padding">
      <div class="flex flex-col items-center justify-center min-h-full">
        <div class="w-full max-w-sm">
          <!-- Logo -->
          <div class="text-center mb-8">
            <div class="text-4xl mb-2">⏱️</div>
            <h1 class="text-2xl font-bold text-gray-900">Flexitime</h1>
            <p class="text-gray-500">Track your presence</p>
          </div>

          <!-- Login Form -->
          <form @submit.prevent="login" class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                v-model="email"
                type="email"
                required
                class="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                placeholder="you@company.com"
              />
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                v-model="password"
                type="password"
                required
                class="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                placeholder="••••••••"
              />
            </div>

            <div v-if="error" class="text-red-600 text-sm">
              {{ error }}
            </div>

            <button
              type="submit"
              :disabled="loading"
              class="w-full py-3 px-4 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              <span v-if="loading">Signing in...</span>
              <span v-else>Sign In</span>
            </button>
          </form>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { IonPage, IonContent } from '@ionic/vue'
import { call } from 'frappe-ui'

const router = useRouter()

const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

async function login() {
  loading.value = true
  error.value = ''

  try {
    await call('login', {
      usr: email.value,
      pwd: password.value,
    })

    // Reload to get new session
    window.location.href = '/flexitime/roll-call'
  } catch (e) {
    error.value = e.messages?.[0] || 'Invalid email or password'
  } finally {
    loading.value = false
  }
}
</script>
