import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import Home from './pages/Home'
import Demo from './Demo'
import Dashboard from './pages/Dashboard'
import ApiKeys from './pages/ApiKeys'
import Usage from './pages/Usage'
import DashboardLayout from './components/DashboardLayout'
import Admin from './pages/admin/Admin'
import Users from './pages/admin/Users'
import AdminLogs from './pages/admin/AdminLogs'
import AdminLayout from './components/admin/AdminLayout'

const queryClient = new QueryClient()

function DashboardWrapper({ children }) {
  return <DashboardLayout>{children}</DashboardLayout>
}

function AdminWrapper({ children }) {
  return <AdminLayout>{children}</AdminLayout>
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/demo" element={<Demo />} />
          <Route path="/dashboard" element={<DashboardWrapper><Dashboard /></DashboardWrapper>} />
          <Route path="/api-keys" element={<DashboardWrapper><ApiKeys /></DashboardWrapper>} />
          <Route path="/usage" element={<DashboardWrapper><Usage /></DashboardWrapper>} />
          <Route path="/admin" element={<AdminWrapper><Admin /></AdminWrapper>} />
          <Route path="/admin/users" element={<AdminWrapper><Users /></AdminWrapper>} />
          <Route path="/admin/logs" element={<AdminWrapper><AdminLogs /></AdminWrapper>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </QueryClientProvider>
  )
}
