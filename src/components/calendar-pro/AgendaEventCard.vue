<template>
  <div
    class="cp-agenda-card"
    role="button"
    tabindex="0"
    :class="{ 'is-task': item.sourceType === 'task', 'is-reminder': item.kind === 'reminder', 'is-linked-reminder': item.sourceType === 'reminder', 'is-completed': item.task?.status === '已完成', 'is-reminder-done': item.kind === 'reminder' && item.reminder_done, 'is-active': selected }"
    :style="{ '--cp-event-color': item.color || '#3b82f6' }"
    @click="$emit('select', { item, additive: $event.metaKey || $event.ctrlKey })"
    @keydown.enter="$emit('select', { item, additive: $event.metaKey || $event.ctrlKey })"
    @keydown.space.prevent="$emit('select', { item, additive: $event.metaKey || $event.ctrlKey })"
    @contextmenu.prevent="$emit('context-item', { item, x: $event.clientX, y: $event.clientY })"
  >
    <button
      v-if="item.sourceType === 'task'"
      type="button"
      class="cp-task-mark"
      :class="{ checked: item.task?.status === '已完成' }"
      :aria-label="item.task?.status === '已完成' ? '标记任务未完成' : '完成任务'"
      @click.stop="$emit('toggle-task', item.task)"
    ><i v-if="item.task?.status === '已完成'" class="fas fa-check" aria-hidden="true"></i></button>
    <span v-else-if="item.sourceType === 'reminder'" class="cp-linked-reminder-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 17h12l-1.4-2.2V10a4.6 4.6 0 0 0-9.2 0v4.8Z"/><path d="M10 19.5a2.2 2.2 0 0 0 4 0"/></svg>
    </span>
    <span v-else class="cp-card-dot" :class="{ done: item.kind === 'reminder' && item.reminder_done }" :role="item.kind === 'reminder' ? 'button' : undefined" :tabindex="item.kind === 'reminder' ? 0 : undefined" @click.stop="item.kind === 'reminder' && $emit('toggle-reminder', item)" @keydown.enter.stop="item.kind === 'reminder' && $emit('toggle-reminder', item)"></span>
    <span class="cp-card-main">
      <span v-if="item.kind !== 'reminder'" class="cp-card-time">{{ eventTimeLabel(item) }}</span>
      <strong class="cp-card-title"><span class="cp-card-title-text">{{ item.title }}</span></strong>
      <span v-if="item.location" class="cp-card-location">{{ item.location }}</span>
      <span v-if="item.notes" class="cp-card-notes">{{ item.notes }}</span>
    </span>
    <button v-if="meetingLinkFor(item)" type="button" class="cp-meeting-link" aria-label="加入会议" @click.stop="$emit('join', meetingLinkFor(item))">
      <i class="fas fa-video" aria-hidden="true"></i>
    </button>
  </div>
</template>

<script setup>
import { eventTimeLabel, meetingLinkFor } from '@utils/calendar-pro.js'

defineProps({
  item: { type: Object, required: true },
  selected: { type: Boolean, default: false }
})
defineEmits(['select', 'context-item', 'join', 'toggle-task', 'toggle-reminder'])
</script>

<style scoped>
.cp-agenda-card {
  position: relative;
  width: 100%;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid color-mix(in srgb, var(--cp-event-color) 18%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--cp-event-color) 7%, var(--bm-bg-card));
  color: var(--bm-text-primary);
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: flex-start;
  gap: 5px;
}
.cp-agenda-card:hover { border-color: color-mix(in srgb, var(--cp-event-color) 34%, transparent); background: color-mix(in srgb, var(--cp-event-color) 11%, var(--bm-bg-card)); }
.cp-agenda-card.is-task { background: color-mix(in srgb, var(--bm-accent-orange) 7%, var(--bm-bg-card)); }
.cp-agenda-card.is-linked-reminder { border-left: 3px solid var(--cp-event-color); background: color-mix(in srgb, var(--cp-event-color) 5%, var(--bm-bg-card)); }
.cp-linked-reminder-mark { width: 15px; height: 15px; margin-top: 3px; color: var(--cp-event-color); flex: 0 0 auto; }
.cp-linked-reminder-mark svg { width: 15px; height: 15px; display: block; }
.cp-agenda-card.is-reminder { background: transparent; border-color: color-mix(in srgb, var(--cp-event-color) 24%, transparent); }
.cp-agenda-card.is-reminder .cp-card-dot { width: 13px; height: 13px; margin-top: 4px; background: transparent; border: 1.5px solid var(--cp-event-color); }
.cp-agenda-card.is-reminder .cp-card-dot.done { background: var(--cp-event-color); transform: scale(1.15); }
.cp-agenda-card.is-reminder .cp-card-title { color: var(--cp-event-color); }
.cp-agenda-card.is-reminder-done { opacity: 0.6; }
.cp-card-title-text { position: relative; display: inline-block; }
.cp-card-title-text::after { content: ""; position: absolute; top: 52%; right: 0; left: 0; height: 1px; background: currentColor; transform: scaleX(0); transform-origin: left center; transition: transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1); }
.cp-agenda-card.is-reminder-done .cp-card-title-text::after { transform: scaleX(1); }
.cp-agenda-card.is-active { border-color: var(--cp-event-color); background: color-mix(in srgb, var(--cp-event-color) 16%, var(--bm-bg-card)); box-shadow: inset 0 0 0 1px var(--cp-event-color); }
.cp-agenda-card.is-completed { opacity: 0.58; }
.cp-agenda-card.is-completed .cp-card-title { text-decoration: line-through; }
.cp-card-dot { width: 5px; height: 5px; margin-top: 5px; border-radius: 50%; background: var(--cp-event-color); flex: 0 0 auto; transition: transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1), background 160ms ease; }
.cp-task-mark { width: 14px; height: 14px; margin-top: 3px; padding: 0; border: 1px solid var(--bm-accent-orange); border-radius: 4px; background: transparent; color: var(--bm-accent-orange); font-size: 7px; display: grid; place-items: center; flex: 0 0 auto; cursor: pointer; }
.cp-task-mark.checked { background: var(--bm-accent-orange); color: #fff; }
.cp-card-main { min-width: 0; flex: 1; display: grid; gap: 1px; }
.cp-meeting-link { width: 23px; height: 23px; flex: 0 0 auto; border: 1px solid color-mix(in srgb, var(--cp-event-color) 24%, transparent); border-radius: 6px; background: color-mix(in srgb, var(--cp-event-color) 8%, transparent); color: var(--cp-event-color); font-size: 9px; cursor: pointer; }
.cp-agenda-card:focus-visible { outline: 2px solid var(--bm-accent-blue); outline-offset: 2px; }
.cp-card-time { color: var(--bm-text-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.cp-card-title { min-width: 0; display: flex; align-items: center; gap: 5px; font-size: 14px; font-weight: 600; }
.cp-card-title-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-card-location { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--bm-text-secondary); font-size: 12px; }
.cp-card-notes { min-width: 0; display: -webkit-box; overflow: hidden; color: var(--bm-text-muted); font-size: 11px; line-height: 1.35; white-space: normal; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
button:focus-visible { outline: 2px solid var(--bm-accent-blue); outline-offset: 2px; }
</style>
