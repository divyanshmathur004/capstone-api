import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { fetchAdminDashboard } from '../../services/api'
import { ErrorFallback, LoadingSpinner } from '../../components/ui/PageState'

const pieColors = ['#64748b', '#0ea5e9', '#2563eb', '#0f172a']

export default function Admin() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: fetchAdminDashboard,
  })

  const retryMutation = useMutation({
    mutationFn: async () => {
      await refetch()
    },
  })

  if (isLoading) {
    return <LoadingSpinner label="Loading admin dashboard..." />
  }

  if (isError) {
    return (
      <ErrorFallback
        title="Admin dashboard unavailable"
        message={error?.message || 'Failed to load admin metrics and charts.'}
        onRetry={() => retryMutation.mutate()}
      />
    )
  }

  const cards = data.cards
  const charts = data.charts

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Admin Dashboard</h1>
        <p className="text-sm text-slate-600">Platform-level metrics and traffic intelligence.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Total Users" value={cards.totalUsers.toLocaleString()} />
        <MetricCard title="Active Users" value={cards.activeUsers.toLocaleString()} />
        <MetricCard title="Total Requests Today" value={cards.totalRequestsToday.toLocaleString()} />
        <MetricCard title="Avg Response Time" value={`${cards.avgResponseTime} ms`} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartShell title="API Requests (Last 30 Days)">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={charts.apiRequests30d}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="day" stroke="#64748b" />
              <YAxis stroke="#64748b" />
              <Tooltip />
              <Line type="monotone" dataKey="requests" stroke="#0f172a" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartShell>

        <ChartShell title="Top States by Usage">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={charts.topStatesByUsage}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="state" stroke="#64748b" />
              <YAxis stroke="#64748b" />
              <Tooltip />
              <Bar dataKey="requests" fill="#0ea5e9" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartShell>

        <ChartShell title="Users by Plan">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={charts.usersByPlan} dataKey="value" nameKey="plan" cx="50%" cy="50%" outerRadius={95} label>
                {charts.usersByPlan.map((entry, index) => (
                  <Cell key={`${entry.plan}-${index}`} fill={pieColors[index % pieColors.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </ChartShell>

        <ChartShell title="Response Time Trends (p95/p99)">
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={charts.responseTimeTrends}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="day" stroke="#64748b" />
              <YAxis stroke="#64748b" />
              <Tooltip />
              <Area type="monotone" dataKey="p95" stroke="#0ea5e9" fill="#bae6fd" />
              <Area type="monotone" dataKey="p99" stroke="#334155" fill="#cbd5e1" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartShell>
      </div>
    </div>
  )
}

function MetricCard({ title, value }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  )
}

function ChartShell({ title, children }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  )
}
