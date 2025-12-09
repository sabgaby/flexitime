<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>Roll Call</ion-title>
        <ion-buttons slot="end">
          <ion-button @click="goToProfile">
            <ion-icon :icon="personCircleOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-refresher slot="fixed" @ionRefresh="refresh">
        <ion-refresher-content />
      </ion-refresher>

      <!-- Month Navigation -->
      <div class="sticky top-0 z-10 bg-white border-b px-4 py-3 flex items-center justify-between">
        <button @click="prevMonth" class="p-2 rounded-full hover:bg-gray-100">
          <ion-icon :icon="chevronBackOutline" class="text-xl" />
        </button>
        <h2 class="text-lg font-semibold text-gray-900">
          {{ monthLabel }}
        </h2>
        <button @click="nextMonth" class="p-2 rounded-full hover:bg-gray-100">
          <ion-icon :icon="chevronForwardOutline" class="text-xl" />
        </button>
      </div>

      <!-- Calendar Grid -->
      <div class="p-4">
        <div v-if="loading" class="flex justify-center py-8">
          <ion-spinner />
        </div>

        <div v-else>
          <!-- Week days header -->
          <div class="grid grid-cols-7 gap-1 mb-2">
            <div
              v-for="day in weekDays"
              :key="day"
              class="text-center text-xs font-medium text-gray-500 py-2"
            >
              {{ day }}
            </div>
          </div>

          <!-- Calendar days -->
          <div class="grid grid-cols-7 gap-1">
            <!-- Empty cells for days before month starts -->
            <div
              v-for="n in firstDayOffset"
              :key="'empty-' + n"
              class="aspect-square"
            />

            <!-- Day cells -->
            <div
              v-for="day in daysInMonth"
              :key="day"
              @click="selectDay(day)"
              class="aspect-square rounded-lg flex flex-col items-center justify-center cursor-pointer transition-all relative"
              :class="getDayClass(day)"
            >
              <span class="text-sm font-medium" :class="isToday(day) ? 'text-primary-600' : ''">
                {{ day }}
              </span>
              <span v-if="getPresenceIcon(day)" class="text-base mt-0.5">
                {{ getPresenceIcon(day) }}
              </span>
              <!-- Leave status indicator -->
              <div
                v-if="getLeaveStatus(day) === 'tentative'"
                class="absolute inset-0 rounded-lg leave-tentative pointer-events-none"
              />
              <div
                v-if="getLeaveStatus(day) === 'draft'"
                class="absolute inset-0 rounded-lg leave-draft pointer-events-none"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Presence Type Selector (Bottom Sheet) -->
      <ion-modal
        :is-open="showSelector"
        :initial-breakpoint="0.6"
        :breakpoints="[0, 0.6, 0.85]"
        @didDismiss="closeSelector"
      >
        <ion-content class="ion-padding">
          <div class="pb-safe-bottom">
            <!-- Header: Employee Name - Date | Split Day checkbox -->
            <div class="flex items-center justify-between mb-4 pb-3 border-b">
              <div class="font-semibold text-gray-900">
                {{ employeeName }} - {{ formatSelectedDateShort }}
              </div>
              <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  v-model="isSplitDay"
                  class="w-4 h-4 text-primary-600 rounded"
                />
                Split Day
              </label>
            </div>

            <!-- Warning for split day mode -->
            <div v-if="isSplitDay" class="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
              Only one half can be Not Working
            </div>

            <!-- Full Day Mode -->
            <div v-if="!isSplitDay">
              <!-- Working Section -->
              <div class="mb-4">
                <h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Working</h4>
                <div class="grid grid-cols-4 gap-2">
                  <button
                    v-for="pt in workingTypes"
                    :key="pt.name"
                    @click="selectFullDayType(pt)"
                    class="flex flex-col items-center p-3 rounded-xl border-2 transition-all"
                    :class="selectedEntry?.presence_type === pt.name
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-gray-200 hover:border-gray-300'"
                  >
                    <span class="text-xl mb-1">{{ pt.icon }}</span>
                    <span class="text-xs text-center text-gray-700 truncate w-full">{{ pt.label }}</span>
                  </button>
                </div>
              </div>

              <!-- Separator -->
              <div class="border-t my-4"></div>

              <!-- Not Working Section -->
              <div>
                <h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Not Working</h4>
                <div class="grid grid-cols-4 gap-2">
                  <button
                    v-for="pt in notWorkingTypes"
                    :key="pt.name"
                    @click="selectFullDayType(pt)"
                    class="flex flex-col items-center p-3 rounded-xl border-2 transition-all"
                    :class="selectedEntry?.presence_type === pt.name
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-gray-200 hover:border-gray-300'"
                  >
                    <span class="text-xl mb-1">{{ pt.icon }}</span>
                    <span class="text-xs text-center text-gray-700 truncate w-full">{{ pt.label }}</span>
                  </button>
                </div>
              </div>
            </div>

            <!-- Split Day Mode -->
            <div v-else class="grid grid-cols-2 gap-4">
              <!-- AM Column -->
              <div class="border rounded-lg p-3">
                <h4 class="text-sm font-semibold text-center mb-3 text-gray-700">AM</h4>

                <!-- AM Working -->
                <div class="mb-3">
                  <h5 class="text-xs font-medium text-gray-500 mb-2">Working</h5>
                  <div class="grid grid-cols-2 gap-1">
                    <button
                      v-for="pt in workingTypes"
                      :key="'am-' + pt.name"
                      @click="selectAmType(pt)"
                      class="flex flex-col items-center p-2 rounded-lg border transition-all"
                      :class="amPresenceType === pt.name
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-gray-200 hover:border-gray-300'"
                    >
                      <span class="text-lg">{{ pt.icon }}</span>
                      <span class="text-xs text-gray-600 truncate w-full text-center">{{ pt.label }}</span>
                    </button>
                  </div>
                </div>

                <!-- AM Not Working -->
                <div>
                  <h5 class="text-xs font-medium text-gray-500 mb-2">Not Working</h5>
                  <div class="grid grid-cols-2 gap-1" :class="{ 'opacity-40 pointer-events-none': pmHasNotWorking }">
                    <button
                      v-for="pt in notWorkingTypes"
                      :key="'am-nw-' + pt.name"
                      @click="selectAmType(pt)"
                      :disabled="pmHasNotWorking"
                      class="flex flex-col items-center p-2 rounded-lg border transition-all"
                      :class="amPresenceType === pt.name
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-gray-200 hover:border-gray-300'"
                    >
                      <span class="text-lg">{{ pt.icon }}</span>
                      <span class="text-xs text-gray-600 truncate w-full text-center">{{ pt.label }}</span>
                    </button>
                  </div>
                </div>
              </div>

              <!-- PM Column -->
              <div class="border rounded-lg p-3">
                <h4 class="text-sm font-semibold text-center mb-3 text-gray-700">PM</h4>

                <!-- PM Working -->
                <div class="mb-3">
                  <h5 class="text-xs font-medium text-gray-500 mb-2">Working</h5>
                  <div class="grid grid-cols-2 gap-1">
                    <button
                      v-for="pt in workingTypes"
                      :key="'pm-' + pt.name"
                      @click="selectPmType(pt)"
                      class="flex flex-col items-center p-2 rounded-lg border transition-all"
                      :class="pmPresenceType === pt.name
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-gray-200 hover:border-gray-300'"
                    >
                      <span class="text-lg">{{ pt.icon }}</span>
                      <span class="text-xs text-gray-600 truncate w-full text-center">{{ pt.label }}</span>
                    </button>
                  </div>
                </div>

                <!-- PM Not Working -->
                <div>
                  <h5 class="text-xs font-medium text-gray-500 mb-2">Not Working</h5>
                  <div class="grid grid-cols-2 gap-1" :class="{ 'opacity-40 pointer-events-none': amHasNotWorking }">
                    <button
                      v-for="pt in notWorkingTypes"
                      :key="'pm-nw-' + pt.name"
                      @click="selectPmType(pt)"
                      :disabled="amHasNotWorking"
                      class="flex flex-col items-center p-2 rounded-lg border transition-all"
                      :class="pmPresenceType === pt.name
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-gray-200 hover:border-gray-300'"
                    >
                      <span class="text-lg">{{ pt.icon }}</span>
                      <span class="text-xs text-gray-600 truncate w-full text-center">{{ pt.label }}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Save button for split day -->
            <div v-if="isSplitDay && amPresenceType && pmPresenceType" class="mt-4 pt-4 border-t">
              <button
                @click="saveSplitDay"
                class="w-full py-3 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 transition-colors"
              >
                Save Split Day
              </button>
            </div>

            <!-- Actions for leave types -->
            <div v-if="!isSplitDay && selectedEntry?.presence_type && isLeaveType(selectedEntry.presence_type)" class="mt-4 pt-4 border-t">
              <a
                v-if="!selectedEntry.leave_application"
                href="/app/leave-application/new"
                target="_blank"
                class="block w-full py-3 text-center text-primary-600 font-medium"
              >
                Create Leave Application →
              </a>
              <a
                v-else
                :href="`/app/leave-application/${selectedEntry.leave_application}`"
                target="_blank"
                class="block w-full py-3 text-center text-primary-600 font-medium"
              >
                View Leave Application →
              </a>
            </div>
          </div>
        </ion-content>
      </ion-modal>

      <!-- Bottom Navigation -->
      <div class="fixed bottom-0 left-0 right-0 bg-white border-t safe-bottom">
        <div class="grid grid-cols-3 py-2">
          <router-link
            to="/roll-call"
            class="flex flex-col items-center py-2 text-primary-600"
          >
            <ion-icon :icon="calendarOutline" class="text-xl" />
            <span class="text-xs mt-1">Roll Call</span>
          </router-link>
          <router-link
            to="/weekly-entry"
            class="flex flex-col items-center py-2 text-gray-500 hover:text-gray-700"
          >
            <ion-icon :icon="timeOutline" class="text-xl" />
            <span class="text-xs mt-1">Weekly</span>
          </router-link>
          <router-link
            to="/profile"
            class="flex flex-col items-center py-2 text-gray-500 hover:text-gray-700"
          >
            <ion-icon :icon="personOutline" class="text-xl" />
            <span class="text-xs mt-1">Profile</span>
          </router-link>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonButton,
  IonIcon, IonSpinner, IonRefresher, IonRefresherContent, IonModal
} from '@ionic/vue'
import {
  chevronBackOutline, chevronForwardOutline, personCircleOutline,
  calendarOutline, timeOutline, personOutline
} from 'ionicons/icons'
import { createResource, call } from 'frappe-ui'

const router = useRouter()

// State
const currentDate = ref(new Date())
const showSelector = ref(false)
const selectedDay = ref(null)
const loading = ref(false)

// Split day state
const isSplitDay = ref(false)
const amPresenceType = ref(null)
const pmPresenceType = ref(null)

const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Computed
const monthLabel = computed(() => {
  return currentDate.value.toLocaleDateString('en', { month: 'long', year: 'numeric' })
})

const monthStart = computed(() => {
  const d = new Date(currentDate.value.getFullYear(), currentDate.value.getMonth(), 1)
  return d.toISOString().split('T')[0]
})

const monthEnd = computed(() => {
  const d = new Date(currentDate.value.getFullYear(), currentDate.value.getMonth() + 1, 0)
  return d.toISOString().split('T')[0]
})

const daysInMonth = computed(() => {
  return new Date(currentDate.value.getFullYear(), currentDate.value.getMonth() + 1, 0).getDate()
})

const firstDayOffset = computed(() => {
  const firstDay = new Date(currentDate.value.getFullYear(), currentDate.value.getMonth(), 1).getDay()
  // Convert Sunday=0 to Monday=0 format
  return firstDay === 0 ? 6 : firstDay - 1
})

const formatSelectedDate = computed(() => {
  if (!selectedDay.value) return ''
  const d = new Date(currentDate.value.getFullYear(), currentDate.value.getMonth(), selectedDay.value)
  return d.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })
})

// Short date format for header: "Tue, 9 December"
const formatSelectedDateShort = computed(() => {
  if (!selectedDay.value) return ''
  const d = new Date(currentDate.value.getFullYear(), currentDate.value.getMonth(), selectedDay.value)
  return d.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'long' })
})

const selectedEntry = computed(() => {
  if (!selectedDay.value || !rollCallData.data?.entries) return null
  const dateStr = getDateString(selectedDay.value)
  const myEntries = rollCallData.data.entries[rollCallData.data.current_employee] || []
  return myEntries.find(e => e.date === dateStr)
})

// Resources
const rollCallData = createResource({
  url: 'flexitime.api.roll_call.get_events',
  makeParams() {
    return {
      month_start: monthStart.value,
      month_end: monthEnd.value,
    }
  },
})

const presenceTypes = createResource({
  url: 'flexitime.api.mobile.get_presence_types',
  auto: true,
})

const employeeData = createResource({
  url: 'flexitime.api.mobile.get_current_employee',
  auto: true,
})

const employeeName = computed(() => {
  return employeeData.data?.employee_name || ''
})

const availablePresenceTypes = computed(() => {
  if (!presenceTypes.data) return []
  // Filter to show only selectable types (not system types)
  return presenceTypes.data.filter(pt => !pt.is_system)
})

// Split presence types into Working and Not Working (Leave)
const workingTypes = computed(() => {
  return availablePresenceTypes.value.filter(pt => pt.category === 'Working')
})

const notWorkingTypes = computed(() => {
  return availablePresenceTypes.value.filter(pt => pt.category === 'Leave')
})

// Check if AM or PM has a "Not Working" type selected
const amHasNotWorking = computed(() => {
  if (!amPresenceType.value) return false
  const pt = presenceTypes.data?.find(p => p.name === amPresenceType.value)
  return pt?.category === 'Leave'
})

const pmHasNotWorking = computed(() => {
  if (!pmPresenceType.value) return false
  const pt = presenceTypes.data?.find(p => p.name === pmPresenceType.value)
  return pt?.category === 'Leave'
})

// Watch for month changes
watch([monthStart, monthEnd], () => {
  rollCallData.fetch()
}, { immediate: true })

// Methods
function getDateString(day) {
  const d = new Date(currentDate.value.getFullYear(), currentDate.value.getMonth(), day)
  return d.toISOString().split('T')[0]
}

function getEntryForDay(day) {
  if (!rollCallData.data?.entries) return null
  const dateStr = getDateString(day)
  const myEmployee = rollCallData.data.current_employee
  const myEntries = rollCallData.data.entries[myEmployee] || []
  return myEntries.find(e => e.date === dateStr)
}

function getPresenceIcon(day) {
  const entry = getEntryForDay(day)
  // For split days, show AM icon (or could show both)
  if (entry?.is_half_day && entry?.am_presence_icon) {
    return entry.am_presence_icon
  }
  return entry?.presence_type_icon || null
}

function getLeaveStatus(day) {
  const entry = getEntryForDay(day)
  return entry?.leave_status || null
}

function getDayClass(day) {
  const entry = getEntryForDay(day)
  const classes = []

  if (isToday(day)) {
    classes.push('ring-2 ring-primary-500')
  }

  if (entry) {
    if (entry.presence_type) {
      // Color based on category
      const pt = presenceTypes.data?.find(p => p.name === entry.presence_type)
      if (pt?.category === 'Working') {
        classes.push('bg-blue-50')
      } else if (pt?.category === 'Leave') {
        classes.push('bg-amber-50')
      } else if (pt?.category === 'Scheduled') {
        classes.push('bg-gray-100')
      }
    }
  } else {
    classes.push('bg-white hover:bg-gray-50')
  }

  return classes.join(' ')
}

function isToday(day) {
  const today = new Date()
  return (
    day === today.getDate() &&
    currentDate.value.getMonth() === today.getMonth() &&
    currentDate.value.getFullYear() === today.getFullYear()
  )
}

function isLeaveType(presenceType) {
  const pt = presenceTypes.data?.find(p => p.name === presenceType)
  return pt?.requires_leave_application || false
}

function prevMonth() {
  currentDate.value = new Date(currentDate.value.getFullYear(), currentDate.value.getMonth() - 1, 1)
}

function nextMonth() {
  currentDate.value = new Date(currentDate.value.getFullYear(), currentDate.value.getMonth() + 1, 1)
}

function selectDay(day) {
  selectedDay.value = day
  // Reset split day state
  const entry = getEntryForDay(day)
  if (entry?.is_half_day) {
    isSplitDay.value = true
    amPresenceType.value = entry.am_presence_type
    pmPresenceType.value = entry.pm_presence_type
  } else {
    isSplitDay.value = false
    amPresenceType.value = null
    pmPresenceType.value = null
  }
  showSelector.value = true
}

function closeSelector() {
  showSelector.value = false
  isSplitDay.value = false
  amPresenceType.value = null
  pmPresenceType.value = null
}

// Full day selection - save immediately
async function selectFullDayType(pt) {
  const dateStr = getDateString(selectedDay.value)

  try {
    await call('flexitime.api.roll_call.save_entry', {
      employee: rollCallData.data.current_employee,
      date: dateStr,
      presence_type: pt.name,
    })

    // Reload data
    await rollCallData.fetch()
    showSelector.value = false
  } catch (error) {
    console.error('Failed to save entry:', error)
  }
}

// AM/PM selection for split day
function selectAmType(pt) {
  amPresenceType.value = pt.name
  // If PM has not working and we're selecting not working for AM, clear PM
  if (pmHasNotWorking.value && pt.category === 'Leave') {
    pmPresenceType.value = null
  }
}

function selectPmType(pt) {
  pmPresenceType.value = pt.name
  // If AM has not working and we're selecting not working for PM, clear AM
  if (amHasNotWorking.value && pt.category === 'Leave') {
    amPresenceType.value = null
  }
}

// Save split day entry
async function saveSplitDay() {
  if (!amPresenceType.value || !pmPresenceType.value) return

  const dateStr = getDateString(selectedDay.value)

  try {
    await call('flexitime.api.roll_call.save_split_entry', {
      employee: rollCallData.data.current_employee,
      date: dateStr,
      am_presence_type: amPresenceType.value,
      pm_presence_type: pmPresenceType.value,
    })

    // Reload data
    await rollCallData.fetch()
    closeSelector()
  } catch (error) {
    console.error('Failed to save split entry:', error)
  }
}

async function refresh(event) {
  await rollCallData.fetch()
  event.target.complete()
}

function goToProfile() {
  router.push('/profile')
}
</script>

<style scoped>
.safe-bottom {
  padding-bottom: env(safe-area-inset-bottom);
}

.pb-safe-bottom {
  padding-bottom: env(safe-area-inset-bottom);
}
</style>
