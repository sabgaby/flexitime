<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/roll-call" />
        </ion-buttons>
        <ion-title>Profile</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <div v-if="employee.data" class="space-y-6">
        <!-- Employee Info -->
        <div class="bg-white rounded-xl p-6 shadow-sm">
          <div class="flex items-center gap-4">
            <div class="w-16 h-16 rounded-full bg-primary-100 flex items-center justify-center text-2xl">
              {{ employee.data.employee_name?.charAt(0) || '?' }}
            </div>
            <div>
              <h2 class="text-xl font-semibold text-gray-900">
                {{ employee.data.employee_name }}
              </h2>
              <p class="text-gray-500">{{ employee.data.designation }}</p>
            </div>
          </div>
        </div>

        <!-- Flexitime Balance -->
        <div class="bg-white rounded-xl p-6 shadow-sm">
          <h3 class="text-lg font-semibold text-gray-900 mb-4">Flexitime Balance</h3>
          <div class="flex items-center justify-between">
            <span class="text-gray-600">Current Balance</span>
            <span
              class="text-2xl font-bold"
              :class="balance >= 0 ? 'text-green-600' : 'text-red-600'"
            >
              {{ balance >= 0 ? '+' : '' }}{{ balance.toFixed(1) }}h
            </span>
          </div>
          <div class="mt-2 text-sm text-gray-500">
            Limit: ±{{ employee.data.flexitime_limit || 20 }}h
          </div>
        </div>

        <!-- Work Pattern -->
        <div v-if="workPattern.data" class="bg-white rounded-xl p-6 shadow-sm">
          <h3 class="text-lg font-semibold text-gray-900 mb-4">Work Pattern</h3>
          <div class="grid grid-cols-7 gap-2 text-center">
            <div v-for="day in weekDays" :key="day.short" class="text-xs">
              <div class="text-gray-500 mb-1">{{ day.short }}</div>
              <div class="font-medium">{{ workPattern.data[day.field] || 0 }}h</div>
            </div>
          </div>
          <div class="mt-4 pt-4 border-t flex justify-between text-sm">
            <span class="text-gray-600">Weekly Total</span>
            <span class="font-medium">{{ workPattern.data.weekly_expected_hours }}h</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-gray-600">FTE</span>
            <span class="font-medium">{{ workPattern.data.fte_percentage }}%</span>
          </div>
        </div>

        <!-- Logout -->
        <button
          @click="logout"
          class="w-full py-3 px-4 bg-red-50 text-red-600 font-medium rounded-lg hover:bg-red-100 transition-colors"
        >
          Sign Out
        </button>
      </div>

      <div v-else class="flex items-center justify-center h-full">
        <ion-spinner />
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup>
import { computed } from 'vue'
import { IonPage, IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonSpinner } from '@ionic/vue'
import { createResource, call } from 'frappe-ui'

const weekDays = [
  { short: 'Mon', field: 'monday_hours' },
  { short: 'Tue', field: 'tuesday_hours' },
  { short: 'Wed', field: 'wednesday_hours' },
  { short: 'Thu', field: 'thursday_hours' },
  { short: 'Fri', field: 'friday_hours' },
  { short: 'Sat', field: 'saturday_hours' },
  { short: 'Sun', field: 'sunday_hours' },
]

const employee = createResource({
  url: 'flexitime.api.mobile.get_current_employee',
  auto: true,
})

const workPattern = createResource({
  url: 'flexitime.api.mobile.get_work_pattern',
  auto: true,
})

const balance = computed(() => {
  return employee.data?.custom_flexitime_balance || 0
})

async function logout() {
  await call('logout')
  window.location.href = '/flexitime/login'
}
</script>
