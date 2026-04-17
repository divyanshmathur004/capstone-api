import { create } from 'zustand'

export const useAdminUiStore = create((set) => ({
  selectedUserId: null,
  userFilters: {
    status: 'all',
    plan: 'all',
  },
  logFilters: {
    dateFrom: '',
    dateTo: '',
    endpoint: 'all',
    statusCode: 'all',
    page: 1,
  },

  setSelectedUserId: (selectedUserId) => set({ selectedUserId }),
  setUserFilter: (key, value) => set((state) => ({
    userFilters: { ...state.userFilters, [key]: value },
  })),
  setLogFilter: (key, value) => set((state) => ({
    logFilters: { ...state.logFilters, [key]: value },
  })),
  resetLogPage: () => set((state) => ({
    logFilters: { ...state.logFilters, page: 1 },
  })),
}))
