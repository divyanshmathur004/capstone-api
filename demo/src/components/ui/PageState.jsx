export function LoadingSpinner({ label = 'Loading...' }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <div className="flex items-center gap-3 text-sm text-slate-600">
        <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
        {label}
      </div>
    </div>
  )
}

export function ErrorFallback({ title = 'Something went wrong', message = 'Please try again.', onRetry }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-6">
      <p className="text-sm font-semibold text-rose-800">{title}</p>
      <p className="mt-1 text-sm text-rose-700">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-md border border-rose-300 px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-100"
        >
          Retry
        </button>
      )}
    </div>
  )
}

export function ErrorState(props) {
  return <ErrorFallback {...props} />
}
