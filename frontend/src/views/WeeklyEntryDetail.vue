<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/weekly-entry" />
        </ion-buttons>
        <ion-title>Weekly Entry</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <div v-if="entry.loading" class="flex justify-center py-8">
        <ion-spinner />
      </div>

      <div v-else-if="entry.data" class="space-y-4">
        <!-- Summary Card -->
        <div class="bg-white rounded-xl p-4 shadow-sm">
          <div class="text-sm text-gray-500 mb-2">
            {{ formatWeekRange(entry.data.week_start, entry.data.week_end) }}
          </div>
          <div class="grid grid-cols-3 gap-4 text-center">
            <div>
              <div class="text-2xl font-bold text-gray-900">
                {{ entry.data.total_actual_hours }}h
              </div>
              <div class="text-xs text-gray-500">Actual</div>
            </div>
            <div>
              <div class="text-2xl font-bold text-gray-900">
                {{ entry.data.total_expected_hours }}h
              </div>
              <div class="text-xs text-gray-500">Expected</div>
            </div>
            <div>
              <div
                class="text-2xl font-bold"
                :class="entry.data.weekly_delta >= 0 ? 'text-green-600' : 'text-red-600'"
              >
                {{ entry.data.weekly_delta >= 0 ? '+' : '' }}{{ entry.data.weekly_delta?.toFixed(1) }}h
              </div>
              <div class="text-xs text-gray-500">Delta</div>
            </div>
          </div>
        </div>

        <!-- Daily Entries -->
        <div class="bg-white rounded-xl shadow-sm overflow-hidden">
          <div class="px-4 py-3 border-b bg-gray-50">
            <h3 class="font-medium text-gray-900">Daily Breakdown</h3>
          </div>
          <div class="divide-y">
            <div
              v-for="daily in entry.data.daily_entries"
              :key="daily.name"
              class="p-4 flex items-center justify-between"
            >
              <div class="flex items-center gap-3">
                <span class="text-xl">{{ daily.presence_type_icon || '📅' }}</span>
                <div>
                  <div class="font-medium text-gray-900">{{ daily.day_of_week }}</div>
                  <div class="text-sm text-gray-500">{{ formatDate(daily.date) }}</div>
                </div>
              </div>
              <div class="text-right">
                <div class="font-medium">
                  {{ daily.actual_hours || 0 }}h / {{ daily.expected_hours || 0 }}h
                </div>
                <div
                  v-if="daily.difference !== 0"
                  class="text-sm"
                  :class="daily.difference >= 0 ? 'text-green-600' : 'text-red-600'"
                >
                  {{ daily.difference >= 0 ? '+' : '' }}{{ daily.difference?.toFixed(1) }}h
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Balance Info -->
        <div class="bg-white rounded-xl p-4 shadow-sm">
          <div class="flex justify-between items-center">
            <span class="text-gray-600">Previous Balance</span>
            <span class="font-medium">{{ entry.data.previous_balance?.toFixed(1) }}h</span>
          </div>
          <div class="flex justify-between items-center mt-2">
            <span class="text-gray-600">Running Balance</span>
            <span
              class="font-bold"
              :class="entry.data.running_balance >= 0 ? 'text-green-600' : 'text-red-600'"
            >
              {{ entry.data.running_balance >= 0 ? '+' : '' }}{{ entry.data.running_balance?.toFixed(1) }}h
            </span>
          </div>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup>
import { IonPage, IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonSpinner } from '@ionic/vue'
import { createResource } from 'frappe-ui'

const props = defineProps({
  id: { type: String, required: true },
})

const entry = createResource({
  url: 'flexitime.api.mobile.get_weekly_entry',
  params: { name: props.id },
  auto: true,
})

function formatWeekRange(start, end) {
  const startDate = new Date(start)
  const endDate = new Date(end)
  const options = { month: 'short', day: 'numeric' }
  return `${startDate.toLocaleDateString('en', options)} - ${endDate.toLocaleDateString('en', options)}`
}

function formatDate(date) {
  return new Date(date).toLocaleDateString('en', { month: 'short', day: 'numeric' })
}
</script>
