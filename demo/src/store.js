import { create } from 'zustand'

export const useUserStore = create((set) => ({
  user: {
    id: 'user_123',
    email: 'user@example.com',
    name: 'John Doe',
    plan: 'pro',
    dailyLimit: 300000,
  },
  
  setUser: (user) => set({ user }),
}))
