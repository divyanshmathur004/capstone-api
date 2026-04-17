import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1'
const API_KEY = import.meta.env.VITE_API_KEY || ''
const API_SECRET = import.meta.env.VITE_API_SECRET || ''
const ADMIN_SECRET = import.meta.env.VITE_ADMIN_SECRET || ''

function deriveAdminBaseUrl(url) {
  const normalized = String(url || '').replace(/\/$/, '')
  if (normalized.endsWith('/api/v1')) {
    return normalized.slice(0, -7)
  }
  return normalized
}

const headers = {}
if (API_KEY) headers['x-api-key'] = API_KEY
if (API_SECRET) headers['x-api-secret'] = API_SECRET

const adminHeaders = {}
if (ADMIN_SECRET) adminHeaders['x-admin-secret'] = ADMIN_SECRET

const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 10000,
  headers,
})

const adminClient = axios.create({
  baseURL: deriveAdminBaseUrl(API_URL),
  timeout: 10000,
  headers: adminHeaders,
})

const statusMap = {
  PENDING_APPROVAL: 'pending',
  REJECTED: 'pending',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
}

export const adminFilterOptions = {
  statuses: ['pending', 'active', 'suspended'],
  plans: ['free', 'premium', 'pro', 'unlimited'],
  endpoints: ['/autocomplete', '/villages', '/districts', '/states'],
}

function unwrapResponse(response) {
  if (!response?.data?.success) {
    throw new Error(response?.data?.message || 'Request failed')
  }
  return response.data
}

function normalizeApiKey(row) {
  return {
    id: row.id,
    name: row.key_name || 'API key',
    key: row.api_key,
    created_at: new Date(row.created_at).toLocaleDateString(),
    status: row.is_active ? 'active' : 'revoked',
  }
}

function normalizeUsageLog(row, idx) {
  return {
    id: row.id || `usage_${idx + 1}`,
    endpoint: row.endpoint || '/unknown',
    status: Number(row.status_code ?? row.status ?? 0),
    responseTime: Number(row.response_ms ?? row.responseTime ?? 0),
    timestamp: row.created_at || row.timestamp || new Date().toISOString(),
  }
}

function groupByDay(logs, lastNDays) {
  const buckets = {}
  const now = new Date()

  for (let i = 0; i < lastNDays; i += 1) {
    const date = new Date(now.getTime() - (lastNDays - i - 1) * 86400000)
    const key = date.toISOString().slice(0, 10)
    buckets[key] = { date: `${date.getMonth() + 1}/${date.getDate()}`, requests: 0 }
  }

  logs.forEach((log) => {
    const key = new Date(log.timestamp).toISOString().slice(0, 10)
    if (buckets[key]) buckets[key].requests += 1
  })

  return Object.values(buckets)
}

function percentile(values, p) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

function normalizeAdminLogsResponse(payload, page = 1, pageSize = 12) {
  const recordsSource = payload?.data || []
  const records = recordsSource.map((raw, idx) => ({
    id: raw.id || `log_${idx + 1}`,
    timestamp: raw.created_at || raw.timestamp,
    apiKeyMasked: raw.api_key || raw.masked_api_key || '***',
    endpoint: raw.endpoint || '/unknown',
    responseTimeMs: Number(raw.response_ms ?? raw.response_time ?? 0),
    statusCode: Number(raw.status_code ?? 0),
    stateCode: raw.state_code || null,
  }))

  const pagination = payload?.pagination || {}
  const total = Number(pagination.total ?? records.length)
  const safePage = Number(pagination.page ?? page)
  const safeLimit = Number(pagination.limit ?? pageSize)

  return {
    records,
    total,
    page: safePage,
    pageSize: safeLimit,
    totalPages: Math.max(1, Math.ceil(total / safeLimit)),
  }
}

export async function autocompleteVillage(query) {
  const response = await apiClient.get('/autocomplete', {
    params: { q: query },
  })
  const payload = unwrapResponse(response)
  return payload.data || []
}

export async function fetchStates() {
  const response = await apiClient.get('/states', { params: { limit: 1000 } })
  const payload = unwrapResponse(response)
  return (payload.data || []).map((state) => ({
    id: Number(state.id),
    code: String(state.code),
    name: state.name,
  }))
}

export async function fetchDashboardSummary() {
  const response = await apiClient.get('/usage')
  const payload = unwrapResponse(response)
  const usage = payload.data?.usage || {}
  const recentLogs = (payload.data?.recentLogs || []).map(normalizeUsageLog)

  const total = recentLogs.length
  const successCount = recentLogs.filter((item) => item.status >= 200 && item.status < 300).length
  const avgResponseTimeMs = total > 0
    ? Math.round(recentLogs.reduce((sum, item) => sum + item.responseTime, 0) / total)
    : 0

  return {
    todayRequests: Number(usage.today || 0),
    monthlyRequests: Number(usage.todayDb || usage.today || 0),
    avgResponseTimeMs,
    successRate: total > 0 ? Number(((successCount / total) * 100).toFixed(2)) : 0,
    chartData: groupByDay(recentLogs, 7),
  }
}

export async function fetchUsageLogs() {
  const response = await apiClient.get('/usage')
  const payload = unwrapResponse(response)
  return (payload.data?.recentLogs || []).map(normalizeUsageLog)
}

export async function fetchApiKeys() {
  const response = await apiClient.get('/api-keys')
  const payload = unwrapResponse(response)
  return (payload.data || []).map(normalizeApiKey)
}

export async function createApiKey({ keyName }) {
  const response = await apiClient.post('/api-keys', { keyName })
  const payload = unwrapResponse(response)

  return {
    id: payload.data.id,
    name: keyName || 'API key',
    key: payload.data.apiKey,
    created_at: new Date(payload.data.createdAt).toLocaleDateString(),
    status: 'active',
  }
}

export async function revokeApiKey({ id }) {
  const response = await apiClient.delete(`/api-keys/${id}`)
  unwrapResponse(response)
  return { id }
}

export async function rotateApiKey({ id }) {
  const response = await apiClient.post(`/api-keys/${id}/rotate`)
  const payload = unwrapResponse(response)

  return {
    id: payload.data.id,
    name: 'Rotated key',
    key: payload.data.apiKey,
    created_at: new Date(payload.data.createdAt).toLocaleDateString(),
    status: 'active',
  }
}

export async function fetchAdminUsers({ status = 'all', plan = 'all' } = {}) {
  const response = await adminClient.get('/api/admin/users', { params: { limit: 200 } })
  const payload = unwrapResponse(response)

  const users = (payload.data || []).map((row) => {
    const normalizedStatus = statusMap[row.status] || 'pending'
    return {
      id: row.id,
      email: row.email,
      fullName: row.name || 'Unknown',
      company: '-',
      plan: (row.plan || 'free').toLowerCase(),
      status: normalizedStatus,
      requestsCount: 0,
      createdAt: row.created_at,
      phone: '-',
      apiKeys: [],
      usageStats: {
        requestsToday: 0,
        requestsThisMonth: 0,
        avgResponseMs: 0,
        successRate: 0,
      },
      access: {
        fullAccess: true,
        states: [],
      },
    }
  })

  return users.filter((user) => {
    const byStatus = status === 'all' || user.status === status
    const byPlan = plan === 'all' || user.plan === plan
    return byStatus && byPlan
  })
}

export async function approveAdminUser({ userId }) {
  const response = await adminClient.post(`/api/admin/users/${userId}/approve`)
  unwrapResponse(response)
  return { ok: true }
}

export async function rejectAdminUser({ userId, reason }) {
  const response = await adminClient.post(`/api/admin/users/${userId}/reject`, { reason })
  unwrapResponse(response)
  return { ok: true }
}

export async function suspendAdminUser({ userId, reason }) {
  const response = await adminClient.post(`/api/admin/users/${userId}/suspend`, { reason: reason || 'Suspended by admin' })
  unwrapResponse(response)
  return { ok: true }
}

export async function updateUserAccess({ userId, fullAccess, states }) {
  if (fullAccess) {
    throw new Error('Full-access toggle endpoint is not available on backend. Use state-level grants/revokes.')
  }

  if (!Array.isArray(states) || states.length === 0) {
    throw new Error('Select at least one state to grant access.')
  }

  const grants = (states || []).map((stateId) =>
    adminClient.post(`/api/admin/users/${userId}/grant-state`, { stateId })
  )
  const responses = await Promise.all(grants)
  responses.forEach((response) => unwrapResponse(response))
  return { ok: true }
}

export async function fetchAdminLogs({
  page = 1,
  pageSize = 12,
  endpoint = 'all',
  statusCode = 'all',
  dateFrom,
  dateTo,
} = {}) {
  const response = await adminClient.get('/api/admin/logs', {
    params: {
      page,
      limit: pageSize,
      endpoint: endpoint === 'all' ? undefined : endpoint,
      statusCode: statusCode === 'all' ? undefined : statusCode,
      startDate: dateFrom || undefined,
      endDate: dateTo || undefined,
    },
  })

  const payload = unwrapResponse(response)
  return normalizeAdminLogsResponse(payload, page, pageSize)
}

export async function fetchAdminResponseMetrics() {
  const response = await adminClient.get('/api/admin/metrics/response-time')
  const payload = unwrapResponse(response)
  const data = payload.data || {}
  return {
    avg: Number(data.avg || 0),
    p95: Number(data.p95 || 0),
    p99: Number(data.p99 || 0),
  }
}

export async function fetchAdminDashboard() {
  const [users, logs, metrics] = await Promise.all([
    fetchAdminUsers({ status: 'all', plan: 'all' }),
    fetchAdminLogs({ page: 1, pageSize: 200 }),
    fetchAdminResponseMetrics(),
  ])

  const requestsToday = logs.records.filter((log) => {
    return new Date(log.timestamp).toDateString() === new Date().toDateString()
  }).length

  const dayMap = {}
  const stateMap = {}
  const responseByDay = {}
  const now = new Date()
  for (let i = 0; i < 30; i += 1) {
    const d = new Date(now.getTime() - (29 - i) * 86400000)
    const key = d.toISOString().slice(0, 10)
    dayMap[key] = { day: `${d.getMonth() + 1}/${d.getDate()}`, requests: 0 }
    responseByDay[key] = []
  }

  logs.records.forEach((item) => {
    const key = new Date(item.timestamp).toISOString().slice(0, 10)
    if (dayMap[key]) {
      dayMap[key].requests += 1
      responseByDay[key].push(item.responseTimeMs)
    }
    const stateKey = item.stateCode || 'NA'
    stateMap[stateKey] = (stateMap[stateKey] || 0) + 1
  })

  const usersByPlan = adminFilterOptions.plans.map((plan) => ({
    plan,
    value: users.filter((item) => item.plan === plan).length,
  }))

  const responseTimeTrends = Object.keys(dayMap).sort().map((key) => ({
    day: dayMap[key].day,
    p95: percentile(responseByDay[key], 95),
    p99: percentile(responseByDay[key], 99),
  }))

  return {
    cards: {
      totalUsers: users.length,
      activeUsers: users.filter((item) => item.status === 'active').length,
      totalRequestsToday: requestsToday,
      avgResponseTime: metrics.avg,
    },
    charts: {
      apiRequests30d: Object.keys(dayMap).sort().map((key) => dayMap[key]),
      topStatesByUsage: Object.entries(stateMap)
        .map(([state, requests]) => ({ state, requests }))
        .sort((a, b) => b.requests - a.requests)
        .slice(0, 7),
      usersByPlan,
      responseTimeTrends: responseTimeTrends.map((item) => ({
        ...item,
        p95: item.p95 || metrics.p95,
        p99: item.p99 || metrics.p99,
      })),
    },
  }
}

export async function exportAdminLogs() {
  const response = await adminClient.get('/api/admin/logs', {
    params: {
      page: 1,
      limit: 200,
    },
  })

  const payload = unwrapResponse(response)
  return normalizeAdminLogsResponse(payload, 1, 200)
}

export { API_URL, apiClient, adminClient }
