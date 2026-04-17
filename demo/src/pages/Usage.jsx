import { useState, useMemo } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { fetchUsageLogs } from '../services/api'
import { ErrorFallback, LoadingSpinner } from '../components/ui/PageState'

export default function Usage() {
  const [dateFrom, setDateFrom] = useState('2024-01-01')
  const [dateTo, setDateTo] = useState('2024-01-31')
  const [endpointFilter, setEndpointFilter] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

  const { data: allLogs = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['b2b-usage-logs'],
    queryFn: fetchUsageLogs,
  })

  const retryMutation = useMutation({
    mutationFn: async () => {
      await refetch()
    },
  })

  if (isLoading) {
    return <LoadingSpinner label="Loading usage logs..." />
  }

  if (isError) {
    return (
      <ErrorFallback
        title="Usage logs unavailable"
        message={error?.message || 'Could not load usage logs.'}
        onRetry={() => retryMutation.mutate()}
      />
    )
  }

  const endpoints = ['all', '/autocomplete', '/villages', '/districts', '/states', '/subdistricts']

  const filteredLogs = useMemo(() => {
    return allLogs.filter((log) => {
      const matchesEndpoint = endpointFilter === 'all' || log.endpoint === endpointFilter
      return matchesEndpoint
    })
  }, [allLogs, endpointFilter])

  const totalPages = Math.ceil(filteredLogs.length / itemsPerPage)
  const paginatedLogs = filteredLogs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)

  const getStatusColor = (status) => {
    if (status >= 200 && status < 300) return 'bg-green-100 text-green-700'
    if (status >= 400 && status < 500) return 'bg-yellow-100 text-yellow-700'
    if (status >= 500) return 'bg-red-100 text-red-700'
    return 'bg-slate-100 text-slate-700'
  }

  const getResponseTimeColor = (time) => {
    if (time < 50) return 'text-green-600'
    if (time < 200) return 'text-yellow-600'
    return 'text-red-600'
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Usage Logs</h1>
        <p className="text-slate-600 mt-1">Track all your API requests and their performance metrics.</p>
      </div>

      <div className="bg-white rounded-xl p-6 border border-slate-200 space-y-4">
        <h3 className="font-semibold text-slate-900">Filters</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">From Date</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">To Date</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Endpoint</label>
            <select
              value={endpointFilter}
              onChange={(e) => {
                setEndpointFilter(e.target.value)
                setCurrentPage(1)
              }}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
            >
              {endpoints.map((ep) => (
                <option key={ep} value={ep}>
                  {ep === 'all' ? 'All Endpoints' : ep}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Endpoint</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Response Time</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {paginatedLogs.map((log) => (
                <tr key={log.id} className="border-b border-slate-200 hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 text-sm text-slate-700 font-mono">{log.endpoint}</td>
                  <td className="px-6 py-4 text-sm">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(log.status)}`}>
                      {log.status}
                    </span>
                  </td>
                  <td className={`px-6 py-4 text-sm font-semibold ${getResponseTimeColor(log.responseTime)}`}>
                    {log.responseTime}ms
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">{log.timestamp}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between">
          <div className="text-sm text-slate-600">
            Showing {paginatedLogs.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0} to{' '}
            {Math.min(currentPage * itemsPerPage, filteredLogs.length)} of {filteredLogs.length} logs
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              ← Previous
            </button>
            <div className="flex items-center gap-2">
              {Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i + 1}
                  onClick={() => setCurrentPage(i + 1)}
                  className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                    currentPage === i + 1
                      ? 'bg-cyan-600 text-white'
                      : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
