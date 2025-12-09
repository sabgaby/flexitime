<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/roll-call" />
        </ion-buttons>
        <ion-title>Weekly Entries</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-refresher slot="fixed" @ionRefresh="refresh">
        <ion-refresher-content />
      </ion-refresher>

      <div class="p-4 space-y-4">
        <div v-if="weeklyEntries.loading" class="flex justify-center py-8">
          <ion-spinner />
        </div>

        <div v-else-if="weeklyEntries.data?.length === 0" class="text-center py-8 text-gray-500">
          No weekly entries found
        </div>

        <div v-else class="space-y-3">
          <router-link
            v-for="entry in weeklyEntries.data"
            :key="entry.name"
            :to="{ name: 'WeeklyEntryDetail', params: { id: entry.name } }"
            class="block bg-white rounded-xl p-4 shadow-sm"
          >
            <div class="flex justify-between items-start">
              <div>
                <div class="font-medium text-gray-900">
                  {{ formatWeekRange(entry.week_start, entry.week_end) }}
                </div>
                <div class="text-sm text-gray-500 mt-1">
                  {{ entry.total_actual_hours }}h / {{ entry.total_expected_hours }}h
                </div>
              </div>
              <div class="text-right">
                <span
                  class="inline-block px-2 py-1 rounded-full text-xs font-medium"
                  :class="getStatusClass(entry.status, entry.docstatus)"
                >
                  {{ entry.status }}
                </span>
                <div
                  class="text-lg font-semibold mt-1"
                  :class="entry.weekly_delta >= 0 ? 'text-green-600' : 'text-red-600'"
                >
                  {{ entry.weekly_delta >= 0 ? '+' : '' }}{{ entry.weekly_delta?.toFixed(1) }}h
                </div>
              </div>
            </div>
          </router-link>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup>
import { IonPage, IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonRefresher, IonRefresherContent, IonSpinner } from '@ionic/vue'
import { createResource } from 'frappe-ui'

const weeklyEntries = createResource({
  url: 'flexitime.api.mobile.get_weekly_entries',
  auto: true,
})

function formatWeekRange(start, end) {
  const startDate = new Date(start)
  const endDate = new Date(end)
  const options = { month: 'short', day: 'numeric' }
  return `${startDate.toLocaleDateString('en', options)} - ${endDate.toLocaleDateString('en', options)}`
}

function getStatusClass(status, docstatus) {
  if (docstatus === 1) {
    return 'bg-green-100 text-green-800'
  } else if (status === 'Draft') {
    return 'bg-gray-100 text-gray-800'
  }
  return 'bg-yellow-100 text-yellow-800'
}

async function refresh(event) {
  await weeklyEntries.reload()
  event.target.complete()
}
</script>
