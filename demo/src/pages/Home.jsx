import { Link } from 'react-router-dom'

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-6">
      <div className="max-w-4xl w-full space-y-12">
        <div className="text-center space-y-4">
          <h1 className="text-5xl font-bold text-white">Welcome to API Portal</h1>
          <p className="text-xl text-slate-300">Choose what you'd like to explore</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <Link
            to="/demo"
            className="group bg-white rounded-2xl p-8 shadow-xl hover:shadow-2xl transition-all hover:scale-105"
          >
            <div className="text-5xl mb-4">📝</div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Demo Contact Form</h2>
            <p className="text-slate-600 mb-6">
              Try out the interactive contact form with village autocomplete and address auto-fill functionality.
            </p>
            <div className="flex items-center text-cyan-600 font-semibold group-hover:gap-2 transition-all">
              Get Started →
            </div>
          </Link>

          <Link
            to="/dashboard"
            className="group bg-gradient-to-br from-cyan-500 to-cyan-600 rounded-2xl p-8 shadow-xl hover:shadow-2xl transition-all hover:scale-105"
          >
            <div className="text-5xl mb-4">📊</div>
            <h2 className="text-2xl font-bold text-white mb-2">B2B Dashboard</h2>
            <p className="text-cyan-100 mb-6">
              Access your API usage metrics, manage keys, and view detailed usage logs.
            </p>
            <div className="flex items-center text-white font-semibold group-hover:gap-2 transition-all">
              View Dashboard →
            </div>
          </Link>
        </div>

        <div className="bg-slate-800 rounded-xl p-8 border border-slate-700 space-y-4">
          <h3 className="text-lg font-semibold text-white">Features</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex gap-3">
              <span className="text-cyan-400 text-xl">✓</span>
              <div>
                <p className="text-white font-medium">Smart Autocomplete</p>
                <p className="text-slate-400 text-sm">Real-time village search with address hierarchy</p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="text-cyan-400 text-xl">✓</span>
              <div>
                <p className="text-white font-medium">API Key Management</p>
                <p className="text-slate-400 text-sm">Create, rotate, and revoke API keys</p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="text-cyan-400 text-xl">✓</span>
              <div>
                <p className="text-white font-medium">Usage Analytics</p>
                <p className="text-slate-400 text-sm">Real-time metrics and performance tracking</p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="text-cyan-400 text-xl">✓</span>
              <div>
                <p className="text-white font-medium">Detailed Logs</p>
                <p className="text-slate-400 text-sm">Filter, search, and paginate API usage</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
