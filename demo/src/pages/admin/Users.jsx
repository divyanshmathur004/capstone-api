import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import UserDetailPanel from '../../components/admin/UserDetailPanel'
import { useAdminUiStore } from '../../adminStore'
import { adminFilterOptions, approveAdminUser, fetchAdminUsers, rejectAdminUser, suspendAdminUser } from '../../services/api'
import { ErrorFallback, ErrorState, LoadingSpinner } from '../../components/ui/PageState'

const statusTone = {
  pending: 'bg-amber-100 text-amber-700',
  active: 'bg-emerald-100 text-emerald-700',
  suspended: 'bg-rose-100 text-rose-700',
}

export default function Users() {
  const queryClient = useQueryClient()
  const [rejectReason, setRejectReason] = useState('')
  const [rejectTarget, setRejectTarget] = useState(null)

  const userFilters = useAdminUiStore((state) => state.userFilters)
  const setUserFilter = useAdminUiStore((state) => state.setUserFilter)
  const selectedUserId = useAdminUiStore((state) => state.selectedUserId)
  const setSelectedUserId = useAdminUiStore((state) => state.setSelectedUserId)

  const { data: users = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-users', userFilters],
    queryFn: () => fetchAdminUsers(userFilters),
  })

  const approveMutation = useMutation({
    mutationFn: approveAdminUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      queryClient.invalidateQueries({ queryKey: ['admin-dashboard'] })
    },
  })

  const rejectMutation = useMutation({
    mutationFn: rejectAdminUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      queryClient.invalidateQueries({ queryKey: ['admin-dashboard'] })
      setRejectTarget(null)
      setRejectReason('')
    },
  })

  const suspendMutation = useMutation({
    mutationFn: suspendAdminUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      queryClient.invalidateQueries({ queryKey: ['admin-dashboard'] })
    },
  })

  const selectedUser = useMemo(() => users.find((item) => item.id === selectedUserId) || null, [users, selectedUserId])

  const applyApprove = (userId) => approveMutation.mutate({ userId })
  const applyReject = (userId, reason = '') => rejectMutation.mutate({ userId, reason })
  const applySuspend = (userId) => suspendMutation.mutate({ userId })

  if (isLoading) {
    return <LoadingSpinner label="Loading users..." />
  }

  if (isError) {
    return (
      <ErrorFallback
        title="Users unavailable"
        message={error?.message || 'Could not load user records.'}
        onRetry={refetch}
      />
    )
  }

  if (approveMutation.isError || rejectMutation.isError || suspendMutation.isError) {
    const message = approveMutation.error?.message || rejectMutation.error?.message || suspendMutation.error?.message
    return (
      <ErrorState
        title="User action failed"
        message={message || 'Could not update user status.'}
        onRetry={() => {
          approveMutation.reset()
          rejectMutation.reset()
          suspendMutation.reset()
          refetch()
        }}
      />
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Users</h1>
        <p className="text-sm text-slate-600">Approve, reject, suspend users and manage their access profile.</p>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Filter by status</label>
            <select
              value={userFilters.status}
              onChange={(event) => setUserFilter('status', event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="all">All Statuses</option>
              {adminFilterOptions.statuses.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Filter by plan</label>
            <select
              value={userFilters.plan}
              onChange={(event) => setUserFilter('plan', event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="all">All Plans</option>
              {adminFilterOptions.plans.map((plan) => (
                <option key={plan} value={plan}>{plan}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px]">
            <thead className="bg-slate-100">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Email</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Plan</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Requests Count</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-t border-slate-200 hover:bg-slate-50">
                  <td
                    className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-800"
                    onClick={() => setSelectedUserId(user.id)}
                  >
                    {user.email}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">{user.plan}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusTone[user.status] || 'bg-slate-100 text-slate-700'}`}>
                      {user.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">{user.requestsCount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => applyApprove(user.id)}
                        className="rounded-md border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => setRejectTarget(user.id)}
                        className="rounded-md border border-amber-300 px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => applySuspend(user.id)}
                        className="rounded-md border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                      >
                        Suspend
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {rejectTarget && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">Reject reason (required)</p>
          <textarea
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            rows={3}
            placeholder="Enter reason for rejection"
            className="mt-2 w-full rounded-md border border-amber-300 px-3 py-2 text-sm"
          />
          <div className="mt-3 flex gap-2">
            <button
              disabled={!rejectReason.trim()}
              onClick={() => applyReject(rejectTarget, rejectReason)}
              className="rounded-md bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Confirm Reject
            </button>
            <button
              onClick={() => {
                setRejectTarget(null)
                setRejectReason('')
              }}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-white"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {selectedUser && (
        <UserDetailPanel user={selectedUser} onClose={() => setSelectedUserId(null)} />
      )}
    </div>
  )
}
