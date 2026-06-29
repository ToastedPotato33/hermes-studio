<script setup lang="ts">
// JACKSON-FORK: Status panel — left column of dual-pane layout
// Shows open loops, pending review count, cron status, active profile
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useProfilesStore } from '@/stores/hermes/profiles'

const profilesStore = useProfilesStore()
const activeName = computed(() => profilesStore.activeProfileName ?? 'default')

// --- Cron jobs ---
interface CronJob {
  id: string
  name: string
  state: string
  last_status?: string
  next_run_at?: string
  schedule_display?: string
}
const jobs = ref<CronJob[]>([])
const jobsError = ref(false)

async function fetchJobs() {
  try {
    const res = await fetch('/api/hermes/jobs')
    if (!res.ok) throw new Error(`${res.status}`)
    const data = await res.json()
    jobs.value = (data.jobs ?? data ?? []).filter((j: CronJob) => j.state !== 'disabled').slice(0, 5)
    jobsError.value = false
  } catch {
    jobsError.value = true
  }
}

// --- Open loops ---
const openLoopsCount = ref<number | null>(null)
const openLoopsError = ref(false)

async function fetchOpenLoops() {
  try {
    const res = await fetch('/api/hermes-proxy/api/files/read?path=' + encodeURIComponent('~/.hermes/secondbrain/open-loops.md'))
    if (!res.ok) throw new Error(`${res.status}`)
    const text = await res.text()
    const matches = text.match(/- \[ \]/g)
    openLoopsCount.value = matches ? matches.length : 0
    openLoopsError.value = false
  } catch {
    openLoopsError.value = true
    openLoopsCount.value = null
  }
}

// --- Pending review ---
const pendingReviewCount = ref<number | null>(null)
const pendingReviewError = ref(false)

async function fetchPendingReview() {
  try {
    const res = await fetch('/api/hermes-proxy/api/files/read?path=' + encodeURIComponent('~/.hermes/secondbrain/pending-review.md'))
    if (!res.ok) throw new Error(`${res.status}`)
    const text = await res.text()
    const matches = text.match(/^reviewed: false$/gm)
    pendingReviewCount.value = matches ? matches.length : 0
    pendingReviewError.value = false
  } catch {
    pendingReviewError.value = true
    pendingReviewCount.value = null
  }
}

function refresh() {
  fetchJobs()
  fetchOpenLoops()
  fetchPendingReview()
}

let interval: ReturnType<typeof setInterval>
onMounted(() => {
  refresh()
  interval = setInterval(refresh, 30_000)
})
onUnmounted(() => clearInterval(interval))

function formatNextRun(iso?: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  const now = new Date()
  const diff = d.getTime() - now.getTime()
  if (diff < 0) return 'overdue'
  const h = Math.floor(diff / 3_600_000)
  const m = Math.floor((diff % 3_600_000) / 60_000)
  if (h > 23) return `${Math.floor(h / 24)}d`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}
</script>

<template>
  <div class="status-panel">
    <div class="panel-header">Status</div>

    <!-- Active profile -->
    <div class="section">
      <div class="section-label">Profile</div>
      <div class="section-value active-profile">{{ activeName }}</div>
    </div>

    <!-- Open loops -->
    <div class="section">
      <div class="section-label">Open Loops</div>
      <div class="section-value" :class="{ error: openLoopsError }">
        <template v-if="openLoopsError">unavailable</template>
        <template v-else-if="openLoopsCount === null">loading…</template>
        <template v-else>{{ openLoopsCount }} item{{ openLoopsCount !== 1 ? 's' : '' }}</template>
      </div>
    </div>

    <!-- Pending review -->
    <div class="section">
      <div class="section-label">Pending Review</div>
      <div class="section-value" :class="{ error: pendingReviewError }">
        <template v-if="pendingReviewError">unavailable</template>
        <template v-else-if="pendingReviewCount === null">loading…</template>
        <template v-else>{{ pendingReviewCount }} concept{{ pendingReviewCount !== 1 ? 's' : '' }}</template>
      </div>
    </div>

    <!-- Cron jobs -->
    <div class="section">
      <div class="section-label">Cron Jobs</div>
      <div v-if="jobsError" class="section-value error">unavailable</div>
      <div v-else-if="jobs.length === 0" class="section-value muted">none</div>
      <div v-else class="job-list">
        <div v-for="job in jobs" :key="job.id" class="job-row">
          <span class="job-name">{{ job.name || job.id }}</span>
          <span class="job-next">{{ formatNextRun(job.next_run_at) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.status-panel {
  width: 220px;
  min-width: 220px;
  height: 100%;
  overflow-y: auto;
  background: var(--bg-secondary, #111);
  border-right: 1px solid var(--border-color, #2a2a2a);
  padding: 12px 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.panel-header {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-tertiary, #555);
  padding: 0 14px 8px;
  border-bottom: 1px solid var(--border-color, #2a2a2a);
  margin-bottom: 8px;
}

.section {
  padding: 6px 14px;
}

.section-label {
  font-size: 11px;
  color: var(--text-tertiary, #555);
  margin-bottom: 2px;
}

.section-value {
  font-size: 13px;
  color: var(--text-primary, #eee);

  &.error { color: var(--error-color, #f87171); font-size: 12px; }
  &.muted { color: var(--text-tertiary, #555); }
}

.active-profile {
  font-weight: 600;
  color: var(--accent-color, #6366f1);
}

.job-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.job-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  gap: 8px;
}

.job-name {
  color: var(--text-primary, #eee);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.job-next {
  color: var(--text-tertiary, #555);
  white-space: nowrap;
  flex-shrink: 0;
}
</style>
