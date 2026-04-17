import { Link, useLocation } from 'react-router-dom'

const navItems = [
  { path: '/admin', label: 'Dashboard' },
  { path: '/admin/users', label: 'Users' },
  { path: '/admin/logs', label: 'API Logs' },
]

export default function AdminSidebar() {
  const location = useLocation()

  return (
    <aside className="fixed left-0 top-0 h-screen w-64 border-r border-slate-200 bg-white p-5">
      <div className="mb-8 border-b border-slate-200 pb-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Admin Panel</p>
        <h1 className="mt-1 text-xl font-bold text-slate-900">Capstone Admin</h1>
      </div>

      <nav className="space-y-2">
        {navItems.map((item) => {
          const active = location.pathname === item.path

          return (
            <Link
              key={item.path}
              to={item.path}
              className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
