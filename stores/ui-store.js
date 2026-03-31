'use client';

import { create } from 'zustand';

export const useUIStore = create((set) => ({
  sidebarOpen: false,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  priceFlashByCode: {},
  flashPrice: (code, direction) =>
    set((state) => ({
      priceFlashByCode: {
        ...state.priceFlashByCode,
        [code]: direction,
      },
    })),
  clearFlash: (code) =>
    set((state) => {
      const next = { ...state.priceFlashByCode };
      delete next[code];
      return { priceFlashByCode: next };
    }),
}));
