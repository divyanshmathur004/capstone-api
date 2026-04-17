import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchStates, updateUserAccess } from '../../services/api'
import { ErrorState } from '../ui/PageState'

const planLabel = {
  free: 'Free',
  premium: 'Premium',
  pro: 'Pro',
  unlimited: 'Unlimited',
}

export default function UserDetailPanel({ user, onClose }) {
  const queryClient = useQueryClient()
  const [fullAccess, setFullAccess] = useState(Boolean(user?.access?.fullAccess))
  const [states, setStates] = useState(user?.access?.states || [])

  const { data: availableStates = [] } = useQuery({
    queryKey: ['state-options'],
    queryFn: fetchStates,
  })

  useEffect(() => {
    setFullAccess(Boolean(user?.access?.fullAccess))
    setStates(user?.access?.states || [])
  }, [user])

  const accessMutation = useMutation({
    mutationFn: updateUserAccess,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    },
  })

  const requestDensity = useMemo(() => {
    if (!user) {
      return 'Low'
    }
    if (user.requestsCount > 150000) {
      return 'High'
    }
    if (user.requestsCount > 50000) {
      return 'Medium'
    }
    return 'Low'
  }, [user])

  if (!user) {
    return null
  }

  const toggleState = (stateId) => {
    if (states.includes(stateId)) {
      setStates(states.filter((item) => item !== stateId))
      return
    }
    setStates([...states, stateId])
  }

  const handleSaveAccess = () => {
    accessMutation.mutate({ userId: user.id, fullAccess, states: fullAccess ? [] : states })
  }

  if (accessMutation.isError) {
    return (
      <ErrorState
        title="State access update failed"
        message={accessMutation.error?.message || 'Could not update state access.'}
        onRetry={() => {
          accessMutation.reset()
          handleSaveAccess()
        }}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/30">
      <div className="absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-start justify-between border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">User Detail</h2>
            <p className="text-sm text-slate-600">{user.email}</p>
          </div>
          <button onClick={onClose} className="rounded-md px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100">
            Close
          </button>
        </div>

        <section className="mb-6 grid grid-cols-2 gap-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Full Name</p>
            <p className="text-sm font-semibold text-slate-900">{user.fullName}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Company</p>
            <p className="text-sm font-semibold text-slate-900">{user.company}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Plan</p>
            <p className="text-sm font-semibold text-slate-900">{planLabel[user.plan] || user.plan}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Request Density</p>
            <p className="text-sm font-semibold text-slate-900">{requestDensity}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Phone</p>
            <p className="text-sm font-semibold text-slate-900">{user.phone}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Joined</p>
            <p className="text-sm font-semibold text-slate-900">{new Date(user.createdAt).toLocaleDateString()}</p>
          </div>
        </section>

        <section className="mb-6 rounded-lg border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">API Keys</h3>
          <div className="mt-3 space-y-2">
            {user.apiKeys.map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-slate-900">{item.name}</p>
                  <p className="text-xs text-slate-500">{item.maskedKey}</p>
                </div>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">{item.status}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-6 rounded-lg border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Usage Stats</h3>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-md bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Requests Today</p>
              <p className="text-sm font-semibold text-slate-900">{user.usageStats.requestsToday.toLocaleString()}</p>
            </div>
            <div className="rounded-md bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Requests This Month</p>
              <p className="text-sm font-semibold text-slate-900">{user.usageStats.requestsThisMonth.toLocaleString()}</p>
            </div>
            <div className="rounded-md bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Avg Response</p>
              <p className="text-sm font-semibold text-slate-900">{user.usageStats.avgResponseMs} ms</p>
            </div>
            <div className="rounded-md bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Success Rate</p>
              <p className="text-sm font-semibold text-slate-900">{user.usageStats.successRate}%</p>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">State Access</h3>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={fullAccess}
                onChange={(event) => setFullAccess(event.target.checked)}
                className="h-4 w-4"
              />
              Full Access
            </label>
          </div>

          {!fullAccess && (
            <div className="grid grid-cols-3 gap-2">
              {availableStates.map((state) => (
                <label key={state.id} className="flex items-center gap-2 rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={states.includes(state.id)}
                    onChange={() => toggleState(state.id)}
                    className="h-4 w-4"
                  />
                  {state.code}
                </label>
              ))}
            </div>
          )}

          <button
            onClick={handleSaveAccess}
            disabled={accessMutation.isPending}
            className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {accessMutation.isPending ? 'Saving...' : 'Save Access'}
          </button>
        </section>
      </div>
    </div>
  )
}
