import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'

import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap/dist/js/bootstrap.bundle.min.js'
import '@hackernoon/pixel-icon-library/fonts/iconfont.css'
import 'quill/dist/quill.snow.css'
import './assets/style.css'
import './styles/bongmaster.css'
import './balatro/balatro.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
