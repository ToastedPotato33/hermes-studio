import { defineStore } from 'pinia'
import { ref } from 'vue'

// JACKSON-FORK: UI state for dual-pane layout mode
export const useCustomUiStore = defineStore('customUi', () => {
  const dualPaneEnabled = ref(localStorage.getItem('custom_dual_pane') === '1')

  function toggleDualPane() {
    dualPaneEnabled.value = !dualPaneEnabled.value
    localStorage.setItem('custom_dual_pane', dualPaneEnabled.value ? '1' : '0')
  }

  return { dualPaneEnabled, toggleDualPane }
})
