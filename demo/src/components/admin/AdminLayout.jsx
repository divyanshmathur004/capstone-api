import AdminSidebar from './AdminSidebar'
import AdminTopbar from './AdminTopbar'

export default function AdminLayout({ children }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <AdminSidebar />
      <AdminTopbar />
      <main className="ml-64 mt-16 p-6">{children}</main>
    </div>
  )
}
