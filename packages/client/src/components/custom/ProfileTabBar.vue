<script setup lang="ts">
// JACKSON-FORK: Profile tab switcher — quick switch between Hermes profiles
import { onMounted, computed } from 'vue'
import { useProfilesStore } from '@/stores/hermes/profiles'

const profilesStore = useProfilesStore()

const profiles = computed(() => profilesStore.profiles)
const activeName = computed(() => profilesStore.activeProfileName ?? 'default')

onMounted(() => {
  if (profiles.value.length === 0) {
    profilesStore.fetchProfiles()
  }
})

async function switchTo(name: string) {
  if (name === activeName.value) return
  await profilesStore.switchProfile(name)
}
</script>

<template>
  <div class="profile-tab-bar">
    <button
      v-for="profile in profiles"
      :key="profile.name"
      class="profile-tab"
      :class="{ active: profile.name === activeName }"
      @click="switchTo(profile.name)"
    >
      {{ profile.name }}
    </button>
  </div>
</template>

<style scoped lang="scss">
.profile-tab-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px 12px 4px;
  border-bottom: 1px solid var(--border-color, #2a2a2a);
}

.profile-tab {
  padding: 3px 10px;
  border-radius: 4px;
  border: 1px solid transparent;
  font-size: 12px;
  cursor: pointer;
  background: transparent;
  color: var(--text-secondary, #888);
  transition: all 0.15s;

  &:hover {
    background: var(--hover-bg, #2a2a2a);
    color: var(--text-primary, #eee);
  }

  &.active {
    background: var(--accent-color, #6366f1);
    color: #fff;
    border-color: var(--accent-color, #6366f1);
  }
}
</style>
