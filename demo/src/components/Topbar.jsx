import { useUserStore } from '../store'

export default function Topbar() {
  const user = useUserStore((state) => state.user)

  const planBadgeColor = {
    free: 'bg-slate-100 text-slate-700',
    premium: 'bg-blue-100 text-blue-700',
    pro: 'bg-purple-100 text-purple-700',
    unlimited: 'bg-green-100 text-green-700',
  }

  return (
    <header className="fixed top-0 left-64 right-0 h-16 border-b border-slate-200 bg-white px-8 shadow-sm flex items-center justify-between z-50">
      <div className="flex-1" />
      
      <div className="flex items-center gap-6">
        <div className="text-right">
          <p className="text-sm font-medium text-slate-900">{user.name}</p>
          <p className="text-xs text-slate-500">{user.email}</p>
        </div>
        
        <div className={`px-3 py-1 rounded-full text-xs font-semibold ${planBadgeColor[user.plan]}`}>
          {user.plan.charAt(0).toUpperCase() + user.plan.slice(1)} Plan
        </div>

        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-400 to-cyan-600 flex items-center justify-center text-white font-bold text-sm">
          {user.name.charAt(0)}{user.name.split(' ')[1]?.charAt(0) || ''}
        </div>
      </div>
    </header>
  )
}
