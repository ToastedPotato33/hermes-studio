<script setup lang="ts">
import { onUnmounted, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { darkTheme, NConfigProvider, NMessageProvider, NDialogProvider, NNotificationProvider } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { getThemeOverrides } from '@/styles/theme'
import { useTheme } from '@/composables/useTheme'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import DesktopTitleBar from '@/components/layout/DesktopTitleBar.vue'
import { useKeyboard } from '@/composables/useKeyboard'
import { useAppStore } from '@/stores/hermes/app'
import SessionSearchModal from '@/components/hermes/chat/SessionSearchModal.vue'
import AuthEventListener from '@/components/auth/AuthEventListener.vue'
import DefaultCredentialPrompt from '@/components/auth/DefaultCredentialPrompt.vue'
import StatusPanel from '@/components/custom/StatusPanel.vue' // JACKSON-FORK
import { useCustomUiStore } from '@/stores/custom/ui' // JACKSON-FORK

const { isDark, isComic } = useTheme()
const { t } = useI18n()
const appStore = useAppStore()
const route = useRoute()
const customUiStore = useCustomUiStore() // JACKSON-FORK

const themeOverrides = computed(() => getThemeOverrides(isDark.value, isComic.value))
const naiveTheme = computed(() => isDark.value ? darkTheme : null)

const isLoginPage = computed(() => route.name === 'login')
const usesPageSidebar = computed(() =>
  ['hermes.chat', 'hermes.session', 'hermes.history', 'hermes.historySession', 'hermes.globalAgent', 'hermes.globalAgentSession', 'hermes.groupChat', 'hermes.groupChatRoom', 'hermes.workflow'].includes(route.name as string),
)
const showAppSidebar = computed(() => !isLoginPage.value && !usesPageSidebar.value)
const showMobileMenuButton = computed(() => !isLoginPage.value && (showAppSidebar.value || usesPageSidebar.value))

const nodeVersionLow = computed(() => {
  const v = appStore.nodeVersion
  const major = parseInt(v.split('.')[0], 10)
  return !isNaN(major) && major < 23
})

const isDesktopShell = computed(() =>
  (window as typeof window & { hermesDesktop?: { isDesktop?: boolean } }).hermesDesktop?.isDesktop === true,
)
const hasDesktopTitleBar = computed(() => {
  const platform = (window as typeof window & { hermesDesktop?: { platform?: string } }).hermesDesktop?.platform
  return isDesktopShell.value && (platform === 'darwin' || platform === 'win32')
})

function handleMobileMenuClick() {
  if (usesPageSidebar.value) {
    window.dispatchEvent(new CustomEvent('hermes:open-page-sidebar'))
    return
  }
  appStore.toggleSidebar()
}

watch(isLoginPage, (loginPage) => {
  if (loginPage) {
    appStore.stopHealthPolling()
    return
  }
  appStore.loadModels()
  appStore.startHealthPolling()
}, {
  immediate: true,
})

onUnmounted(() => {
  appStore.stopHealthPolling()
})

useKeyboard()
</script>

<template>
  <NConfigProvider :theme="naiveTheme" :theme-overrides="themeOverrides">
    <NMessageProvider>
      <AuthEventListener />
      <NDialogProvider>
        <NNotificationProvider>
          <div class="app-shell" :class="{ desktop: isDesktopShell, 'desktop-titlebar-host': hasDesktopTitleBar }">
            <DesktopTitleBar v-if="isDesktopShell" />
            <div v-if="nodeVersionLow" class="node-warning-bar">
              {{ t('sidebar.nodeVersionWarning', { version: appStore.nodeVersion }) }}
            </div>
            <div class="app-layout" :class="{ 'no-sidebar': isLoginPage || !showAppSidebar }">
              <button v-if="showMobileMenuButton" class="hamburger-btn" @click="handleMobileMenuClick">
                <img src="/logo.png" alt="Menu" style="width: 24px; height: 24px;" />
              </button>
              <div v-if="!isLoginPage && showAppSidebar && appStore.sidebarOpen" class="mobile-backdrop" @click="appStore.closeSidebar" />
              <AppSidebar v-if="!isLoginPage && showAppSidebar" />
              <!-- JACKSON-FORK: dual-pane status panel -->
              <StatusPanel v-if="customUiStore.dualPaneEnabled && !isLoginPage" />
              <!-- END JACKSON-FORK -->
              <main class="app-main">
                <router-view />
              </main>
              <!-- JACKSON-FORK: dual-pane toggle button -->
              <button
                class="dual-pane-toggle"
                :title="customUiStore.dualPaneEnabled ? 'Exit dual-pane' : 'Dual-pane mode'"
                @click="customUiStore.toggleDualPane()"
              >⊞</button>
              <!-- END JACKSON-FORK -->
            </div>
          </div>
          <SessionSearchModal />
          <DefaultCredentialPrompt />
        </NNotificationProvider>
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.app-shell {
  height: calc(100 * var(--vh));
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background-color: $bg-primary;
}

.app-layout {
  display: flex;
  flex: 1;
  min-height: 0;
  width: 100%;
  max-width: 100%;
  overflow: hidden;

  &.no-sidebar {
    display: block;
  }
}

.app-shell.desktop-titlebar-host .app-layout {
  --vh: calc(1vh - 0.36px);
}

.app-main {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  background-color: $bg-primary;

  .no-sidebar & {
    height: 100%;
  }
}

.node-warning-bar {
  flex: 0 0 auto;
  width: 100%;
  z-index: 100;
  padding: 4px 16px;
  font-size: 12px;
  font-weight: 500;
  color: #b45309;
  background-color: #fef3c7;
  border-bottom: 1px solid #fde68a;
  text-align: center;
  line-height: 1.4;
}

/* JACKSON-FORK: dual-pane toggle */
.dual-pane-toggle {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 200;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid var(--border-color, #2a2a2a);
  background: var(--bg-secondary, #111);
  color: var(--text-tertiary, #666);
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  &:hover { color: var(--text-primary, #eee); border-color: var(--accent-color, #6366f1); }
}
/* END JACKSON-FORK */
</style>
