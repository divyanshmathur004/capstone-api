import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createApiKey, fetchApiKeys, revokeApiKey, rotateApiKey } from '../services/api'
import { ErrorFallback, ErrorState, LoadingSpinner } from '../components/ui/PageState'

export default function ApiKeys() {
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [copied, setCopied] = useState(null)

  const { data: apiKeys = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['api-keys'],
    queryFn: fetchApiKeys,
  })

  const createMutation = useMutation({
    mutationFn: createApiKey,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
      setNewKeyName('')
      setShowCreate(false)
    },
  })

  const revokeMutation = useMutation({
    mutationFn: revokeApiKey,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
    },
  })

  const rotateMutation = useMutation({
    mutationFn: rotateApiKey,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
    },
  })

  if (isLoading) {
    return <LoadingSpinner label="Loading API keys page..." />
  }

  if (isError) {
    return (
      <ErrorFallback
        title="API keys unavailable"
        message={error?.message || 'Could not initialize API keys page.'}
        onRetry={refetch}
      />
    )
  }

  if (createMutation.isError || revokeMutation.isError || rotateMutation.isError) {
    const message = createMutation.error?.message || revokeMutation.error?.message || rotateMutation.error?.message
    return (
      <ErrorState
        title="API key action failed"
        message={message || 'Could not complete API key operation.'}
        onRetry={() => {
          createMutation.reset()
          revokeMutation.reset()
          rotateMutation.reset()
          refetch()
        }}
      />
    )
  }

  const handleCreateKey = () => {
    if (!newKeyName.trim()) return
    createMutation.mutate({ keyName: newKeyName.trim() })
  }

  const handleCopy = (keyId) => {
    setCopied(keyId)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">API Keys</h1>
          <p className="text-slate-600 mt-1">Manage your API keys and authentication credentials.</p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-cyan-600 text-white rounded-lg font-medium hover:bg-cyan-700 transition-colors"
        >
          + Create New Key
        </button>
      </div>

      {showCreate && (
        <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-6">
          <h3 className="font-semibold text-slate-900 mb-4">Create New API Key</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Key Name</label>
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g., Production Key, Mobile App"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleCreateKey}
                className="px-4 py-2 bg-cyan-600 text-white rounded-lg font-medium hover:bg-cyan-700 transition-colors"
              >
                Create Key
              </button>
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg font-medium hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {apiKeys.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
            <p className="text-slate-600">No API keys yet. Create one to get started.</p>
          </div>
        ) : (
          apiKeys.map((key) => (
            <div key={key.id} className="bg-white border border-slate-200 rounded-xl p-6 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">{key.name}</h3>
                  <p className="text-sm text-slate-600 mt-1">Created {key.created_at}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 bg-green-100 text-green-700 text-xs font-semibold rounded-full">
                    {key.status}
                  </span>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4 flex items-center justify-between">
                <code className="text-sm text-slate-600 font-mono">{key.key}</code>
                <button
                  onClick={() => handleCopy(key.id)}
                  className={`ml-4 px-3 py-1 text-sm font-medium rounded transition-colors ${
                    copied === key.id
                      ? 'bg-green-100 text-green-700'
                      : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                  }`}
                >
                  {copied === key.id ? '✓ Copied' : 'Copy'}
                </button>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => rotateMutation.mutate({ id: key.id })}
                  disabled={rotateMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-blue-600 border border-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
                >
                  🔄 Rotate Key
                </button>
                <button
                  onClick={() => revokeMutation.mutate({ id: key.id })}
                  disabled={revokeMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-red-600 border border-red-600 rounded-lg hover:bg-red-50 transition-colors"
                >
                  ✕ Revoke
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
