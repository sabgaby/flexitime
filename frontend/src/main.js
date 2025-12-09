import { createApp } from 'vue'
import { IonicVue } from '@ionic/vue'
import { FrappeUI, setConfig, frappeRequest } from 'frappe-ui'
import App from './App.vue'
import router from './router'

import './main.css'

// Ionic CSS
import '@ionic/vue/css/core.css'
import '@ionic/vue/css/normalize.css'
import '@ionic/vue/css/structure.css'
import '@ionic/vue/css/typography.css'
import '@ionic/vue/css/padding.css'
import '@ionic/vue/css/float-elements.css'
import '@ionic/vue/css/text-alignment.css'
import '@ionic/vue/css/text-transformation.css'
import '@ionic/vue/css/flex-utils.css'
import '@ionic/vue/css/display.css'

// Configure Frappe UI
setConfig('resourceFetcher', frappeRequest)

const app = createApp(App)

app.use(IonicVue, {
  mode: 'ios', // Use iOS styling for consistency
})

app.use(router)
app.use(FrappeUI)

// Global error handler
app.config.errorHandler = (err, vm, info) => {
  console.error('Vue Error:', err, info)
}

// Wait for router and Ionic to be ready
router.isReady().then(() => {
  app.mount('#app')
})
