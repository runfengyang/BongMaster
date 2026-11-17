<template>
  <svg
    class="rm-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <g v-html="icon" />
  </svg>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  name: { type: String, default: 'list' },
  size: { type: [Number, String], default: 18 },
  strokeWidth: { type: [Number, String], default: 1.7 }
})

const ICONS = {
  list: '<circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none"/><path d="M8.5 6h11M8.5 12h11M8.5 18h11"/>',
  'list-plus': '<circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none"/><path d="M8.5 6h8M8.5 12h8M8.5 18h5M19 15v6M16 18h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9 4.5v15"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.2"/><path d="M15.4 15.4 20 20"/>',
  ellipsis: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M7.5 3.5v3M16.5 3.5v3M3.5 9.5h17"/><circle cx="8" cy="13" r=".9" fill="currentColor" stroke="none"/><circle cx="12" cy="13" r=".9" fill="currentColor" stroke="none"/><circle cx="16" cy="13" r=".9" fill="currentColor" stroke="none"/>',
  today: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M7.5 3.5v3M16.5 3.5v3M3.5 9.5h17"/><path d="M8 13h3M8 16.5h7"/>',
  tray: '<path d="M3.5 13.5h4l1.8 2.8h5.4l1.8-2.8h4"/><rect x="3.5" y="5" width="17" height="14" rx="2.5"/>',
  flag: '<path d="M6 21V4.2h11.8l-2.7 4.3 2.7 4.3H6"/>',
  alarm: '<circle cx="12" cy="13" r="7"/><path d="M12 9.5V13l2.4 1.6M5 4.5 2.8 6.7M19 4.5l2.2 2.2"/>',
  check: '<path d="m4.8 12.8 4.4 4.4L19.2 6.8"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-right': '<path d="m9 6 6 6-6 6"/>',
  'chevron-left': '<path d="m15 6-6 6 6 6"/>',
  info: '<circle cx="12" cy="12" r="8.2"/><path d="M12 11v5"/><circle cx="12" cy="7.8" r=".9" fill="currentColor" stroke="none"/>',
  trash: '<path d="M4.5 6.5h15M9 6.5V4.8h6v1.7M6.5 6.5l.8 13h9.4l.8-13M10 10v6M14 10v6"/>',
  note: '<rect x="4.5" y="4" width="15" height="16" rx="2.5"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  link: '<path d="M10 13.8a3.8 3.8 0 0 0 5.4 0l2.2-2.2a3.8 3.8 0 0 0-5.4-5.4L11 7.4"/><path d="M14 10.2a3.8 3.8 0 0 0-5.4 0l-2.2 2.2a3.8 3.8 0 0 0 5.4 5.4l1.2-1.2"/>',
  tag: '<path d="M4.5 5.2V11l8.4 8.4a1.8 1.8 0 0 0 2.5 0l4-4a1.8 1.8 0 0 0 0-2.5L11 4.5H5.2A.7.7 0 0 0 4.5 5.2Z"/><circle cx="8.2" cy="8.2" r="1.1" fill="currentColor" stroke="none"/>',
  paperclip: '<path d="m9 12.5 5.2-5.2a3 3 0 0 1 4.2 4.2l-6.7 6.7a4.6 4.6 0 0 1-6.5-6.5l6.9-6.9"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  chart: '<path d="M4.5 19.5h15M7.5 16V11M12 16V6.5M16.5 16v-3.2"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  repeat: '<path d="M5 8.5A5.5 5.5 0 0 1 10.5 3H18M18 3l-2.4-2.4M18 3l-2.4 2.4"/><path d="M19 15.5A5.5 5.5 0 0 1 13.5 21H6M6 21l2.4 2.4M6 21l2.4-2.4"/>',
  folder: '<path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3.2l2 2H18a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5Z"/>',
  sort: '<path d="M7 5v14M7 19l-2.6-2.6M7 19l2.6-2.6M17 19V5M17 5l-2.6 2.6M17 5l2.6 2.6"/>',
  bell: '<path d="M6 17h12l-1.4-2.2V10a4.6 4.6 0 0 0-9.2 0v4.8Z"/><path d="M10 19.5a2.2 2.2 0 0 0 4 0"/>',
  sync: '<path d="M20 11.5a8 8 0 0 0-13.9-5.4L4 8"/><path d="M4 4.5V8h3.5"/><path d="M4 12.5a8 8 0 0 0 13.9 5.4L20 16"/><path d="M20 19.5V16h-3.5"/>',
  pin: '<path d="m9 4 6 6-1.4 1.4 3 3-1.6 1.6-3-3L10.6 14 4 7.4 5.4 6l3 3L9.8 7.6Z"/><path d="m4 20 5-5"/>',
  'check-circle': '<circle cx="12" cy="12" r="8.2"/><path d="m8.2 12.2 2.6 2.6 5-5"/>',
  'arrow-right': '<path d="M4.5 12h15M13.5 6l6 6-6 6"/>',
  'arrow-up-right': '<path d="M7 17 17 7M8 7h9v9"/>',
  exclamation: '<path d="M12 4.5v10.2"/><circle cx="12" cy="19" r="1.1" fill="currentColor" stroke="none"/>',
  'bell-off': '<path d="M6 17h12l-1.4-2.2V10a4.6 4.6 0 0 0-7.8-3.3M9 17v2.5a2.2 2.2 0 0 0 4 0"/><path d="m4 4 16 16"/>'
}

const icon = computed(() => ICONS[props.name] || ICONS.list)
</script>

<style scoped>
.rm-icon {
  display: block;
  flex: 0 0 auto;
}
</style>
