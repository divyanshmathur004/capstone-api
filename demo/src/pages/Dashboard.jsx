import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useUserStore } from '../store'
import { fetchDashboardSummary } from '../services/api'
import { ErrorFallback, LoadingSpinner } from '../components/ui/PageState'

export default function Dashboard() {
  const user = useUserStore((state) => state.user)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['b2b-dashboard-summary'],
    queryFn: fetchDashboardSummary,
  })

  const retryMutation = useMutation({
    mutationFn: async () => {
      await refetch()
    },
  })

  if (isLoading) {
    return <LoadingSpinner label="Loading dashboard summary..." />
  }

  if (isError) {
    return (
      <ErrorFallback
        title="Dashboard unavailable"
        message={error?.message || 'Could not load dashboard metrics.'}
        onRetry={() => retryMutation.mutate()}
      />
    )
  }

  const chartData = data?.chartData || []

  const cards = [
    {
      title: "Today's Requests",
      value: (data?.todayRequests || 0).toLocaleString(),
      subtitle: 'of 300K daily limit',
      color: 'cyan',
      icon: '📊',
    },
    {
      title: 'Daily Limit',
      value: `${(user.dailyLimit / 1000).toFixed(0)}K`,
      subtitle: 'requests per day',
      color: 'blue',
      icon: '⚡',
    },
    {
      title: "This Month's Requests",
      value: (data?.monthlyRequests || 0).toLocaleString(),
      subtitle: '+12% from last month',
      color: 'purple',
      icon: '📈',
    },
    {
      title: 'Avg Response Time',
      value: `${data?.avgResponseTimeMs || 0}ms`,
      subtitle: 'last 24 hours',
      color: 'green',
      icon: '⏱️',
    },
    {
      title: 'Success Rate',
      value: `${data?.successRate || 0}%`,
      subtitle: 'all requests',
      color: 'emerald',
      icon: '✅',
    },
  ]

  const colorMap = {
    cyan: 'from-cyan-400 to-cyan-600',
    blue: 'from-blue-400 to-blue-600',
    purple: 'from-purple-400 to-purple-600',
    green: 'from-green-400 to-green-600',
    emerald: 'from-emerald-400 to-emerald-600',
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-600 mt-1">Welcome back! Here's your API usage overview.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {cards.map((card, idx) => (
          <div key={idx} className="bg-white rounded-xl p-6 shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
            <div className={`inline-block text-2xl p-2 rounded-lg bg-gradient-to-br ${colorMap[card.color]} text-white mb-3`}>
              {card.icon}
            </div>
            <h3 className="text-slate-600 text-sm font-medium">{card.title}</h3>
            <p className="text-2xl font-bold text-slate-900 mt-2">{card.value}</p>
            <p className="text-xs text-slate-500 mt-2">{card.subtitle}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl p-8 shadow-sm border border-slate-200">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-slate-900">API Usage (Last 7 Days)</h2>
          <p className="text-sm text-slate-600 mt-1">Request volume over the past week</p>
        </div>

        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" stroke="#94a3b8" />
            <YAxis stroke="#94a3b8" />
            <Tooltip
              contentStyle={{
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
              }}
              formatter={(value) => [`${value.toLocaleString()} requests`, 'Requests']}
              labelStyle={{ color: '#475569' }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="requests"
              stroke="#06b6d4"
              strokeWidth={2}
              dot={{ fill: '#06b6d4', r: 4 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
