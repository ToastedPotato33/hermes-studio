<script setup lang="ts">
// JACKSON-FORK: Macro buttons — one-tap skill/cron triggers in the chat composer
import { ref } from 'vue'
import { useChatStore } from '@/stores/hermes/chat'

const chatStore = useChatStore()
const sending = ref<string | null>(null)

const macros = [
  {
    id: 'brain-dump',
    label: '🧠 Brain Dump',
    prompt: 'I want to do a quick brain dump. Please capture everything I say next and file it to my secondbrain captures.',
  },
  {
    id: 'review',
    label: '📚 Review',
    prompt: '/review',
  },
  {
    id: 'sunday-summary',
    label: '📋 Sunday Summary',
    prompt: 'Run the Sunday review now — read all files in ~/.hermes/secondbrain/ and produce the weekly review with captures, tasks, reminders, open loops, and one friction fix.',
  },
]

async function runMacro(macro: typeof macros[0]) {
  if (sending.value) return
  sending.value = macro.id
  try {
    await chatStore.sendMessage(macro.prompt)
  } finally {
    sending.value = null
  }
}
</script>

<template>
  <div class="macro-bar">
    <button
      v-for="macro in macros"
      :key="macro.id"
      class="macro-btn"
      :class="{ loading: sending === macro.id }"
      :disabled="!!sending"
      @click="runMacro(macro)"
    >
      {{ sending === macro.id ? '…' : macro.label }}
    </button>
  </div>
</template>

<style scoped lang="scss">
.macro-bar {
  display: flex;
  gap: 6px;
  padding: 6px 12px 2px;
  flex-wrap: wrap;
}

.macro-btn {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--border-color, #2a2a2a);
  font-size: 12px;
  cursor: pointer;
  background: var(--bg-secondary, #1a1a1a);
  color: var(--text-primary, #eee);
  transition: all 0.15s;
  white-space: nowrap;

  &:hover:not(:disabled) {
    background: var(--accent-color, #6366f1);
    border-color: var(--accent-color, #6366f1);
    color: #fff;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &.loading {
    opacity: 0.7;
  }
}
</style>
