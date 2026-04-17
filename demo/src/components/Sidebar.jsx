import { Link, useLocation } from 'react-router-dom'

export default function Sidebar() {
  const location = useLocation()

  const navItems = [
    { path: '/dashboard', label: '📊 Dashboard', icon: 'dashboard' },
    { path: '/api-keys', label: '🔑 API Keys', icon: 'keys' },
    { path: '/usage', label: '📈 Usage Logs', icon: 'usage' },
  ]

  const isActive = (path) => location.pathname === path

  return (
    <aside className="fixed left-0 top-0 h-screen w-64 border-r border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-cyan-600">API Portal</h1>
        <p className="text-xs text-slate-500 mt-1">B2B Dashboard</p>
      </div>

      <nav className="space-y-2">
        {navItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={`block px-4 py-2.5 rounded-lg transition-colors font-medium text-sm ${
              isActive(item.path)
                ? 'bg-cyan-50 text-cyan-700 border-l-2 border-cyan-600'
                : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="absolute bottom-6 left-6 right-6 border-t border-slate-200 pt-4">
        <button className="w-full px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-lg transition-colors">
          🚪 Logout
        </button>
      </div>
    </aside>
  )
}
