export default function AdminTopbar() {
  const adminUser = {
    name: 'Platform Admin',
    email: 'admin@example.com',
  }

  return (
    <header className="fixed left-64 right-0 top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6">
      <div>
        <p className="text-sm font-semibold text-slate-900">Control Center</p>
        <p className="text-xs text-slate-500">Monitoring users, traffic and access</p>
      </div>

      <div className="text-right">
        <p className="text-sm font-medium text-slate-900">{adminUser.name}</p>
        <p className="text-xs text-slate-500">{adminUser.email}</p>
      </div>
    </header>
  )
}
