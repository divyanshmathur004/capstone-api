import { useMutation, useQuery } from '@tanstack/react-query'
import { useAdminUiStore } from '../../adminStore'
import { adminFilterOptions, exportAdminLogs, fetchAdminLogs } from '../../services/api'
import { ErrorFallback, ErrorState, LoadingSpinner } from '../../components/ui/PageState'

const today = new Date()
const defaultDateFrom = new Date(today.getTime() - 7 * 86400000).toISOString().slice(0, 10)
const defaultDateTo = today.toISOString().slice(0, 10)

const statusOptions = ['all', '200', '201', '400', '403', '429', '500']

export default function AdminLogs() {
  const filters = useAdminUiStore((state) => state.logFilters)
  const setLogFilter = useAdminUiStore((state) => state.setLogFilter)
  const resetLogPage = useAdminUiStore((state) => state.resetLogPage)

  const queryArgs = {
    ...filters,
    dateFrom: filters.dateFrom || defaultDateFrom,
    dateTo: filters.dateTo || defaultDateTo,
  }

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-logs', queryArgs],
    queryFn: () => fetchAdminLogs(queryArgs),
  })

  const exportMutation = useMutation({
    mutationFn: exportAdminLogs,
  })

  const logs = data?.records || []

  const onFilterChange = (key, value) => {
    setLogFilter(key, value)
    resetLogPage()
  }

  const goToPage = (page) => {
    if (!data) {
      return
    }
    const safePage = Math.max(1, Math.min(data.totalPages, page))
    setLogFilter('page', safePage)
  }

  const exportData = async () => {
    await exportMutation.mutateAsync()
    window.alert('Export queued. This is a basic placeholder action.')
  }

  if (isLoading) {
    return <LoadingSpinner label="Loading API logs..." />
  }

  if (isError) {
    return (
      <ErrorFallback
        title="API logs unavailable"
        message={error?.message || 'Could not load admin logs.'}
        onRetry={refetch}
      />
    )
  }

  if (exportMutation.isError) {
    return (
      <ErrorState
        title="Export failed"
        message={exportMutation.error?.message || 'Could not export API logs.'}
        onRetry={() => exportMutation.reset()}
      />
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">API Logs</h1>
          <p className="text-sm text-slate-600">Inspect request-level traffic for all users.</p>
        </div>
        <button
          onClick={exportData}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Export
        </button>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <FilterField label="Date From">
            <input
              type="date"
              value={queryArgs.dateFrom}
              onChange={(event) => onFilterChange('dateFrom', event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </FilterField>
          <FilterField label="Date To">
            <input
              type="date"
              value={queryArgs.dateTo}
              onChange={(event) => onFilterChange('dateTo', event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </FilterField>
          <FilterField label="Endpoint">
            <select
              value={queryArgs.endpoint}
              onChange={(event) => onFilterChange('endpoint', event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="all">All Endpoints</option>
              {adminFilterOptions.endpoints.map((endpoint) => (
                <option key={endpoint} value={endpoint}>{endpoint}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Status Code">
            <select
              value={queryArgs.statusCode}
              onChange={(event) => onFilterChange('statusCode', event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {statusOptions.map((status) => (
                <option key={status} value={status}>{status === 'all' ? 'All Statuses' : status}</option>
              ))}
            </select>
          </FilterField>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px]">
            <thead className="bg-slate-100">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Timestamp</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">API Key</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Endpoint</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Response Time</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Status Code</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-500">No logs found for selected filters.</td>
                </tr>
              )}
              {logs.map((log) => (
                <tr key={log.id} className="border-t border-slate-200 hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm text-slate-700">{new Date(log.timestamp).toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm font-mono text-slate-700">{log.apiKeyMasked}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{log.endpoint}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{log.responseTimeMs} ms</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusTone(log.statusCode)}`}>
                      {log.statusCode}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
          <p className="text-sm text-slate-600">
            Total records: {data?.total ?? 0}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => goToPage((data?.page || 1) - 1)}
              disabled={!data || data.page <= 1}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700 disabled:opacity-50"
            >
              Prev
            </button>
            <span className="text-sm text-slate-700">
              Page {data?.page || 1} / {data?.totalPages || 1}
            </span>
            <button
              onClick={() => goToPage((data?.page || 1) + 1)}
              disabled={!data || data.page >= data.totalPages}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

function FilterField({ label, children }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</label>
      {children}
    </div>
  )
}

function statusTone(code) {
  if (code >= 200 && code < 300) {
    return 'bg-emerald-100 text-emerald-700'
  }
  if (code >= 400 && code < 500) {
    return 'bg-amber-100 text-amber-700'
  }
  return 'bg-rose-100 text-rose-700'
}
