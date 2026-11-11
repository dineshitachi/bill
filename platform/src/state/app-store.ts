"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AppStoreState = {
  activeView: string;
  theme: "dark" | "slate" | "corporate";
  globalSearch: string;
};

type AppStoreActions = {
  setActiveView: (activeView: string) => void;
  setTheme: (theme: AppStoreState["theme"]) => void;
  setGlobalSearch: (globalSearch: string) => void;
  resetTransientState: () => void;
};

export type AppStore = AppStoreState & AppStoreActions;

export const useAppStore = create<AppStore>()(persist((set) => ({
  activeView: "dashboard",
  theme: "slate",
  globalSearch: "",
  setActiveView: (activeView) => set({ activeView }),
  setTheme: (theme) => set({ theme }),
  setGlobalSearch: (globalSearch) => set({ globalSearch }),
  resetTransientState: () => set({ activeView: "dashboard", globalSearch: "" }),
}), {
  name: "bill-my-book-app-state",
  partialize: (state) => ({ activeView: state.activeView, theme: state.theme, globalSearch: state.globalSearch }),
}));

export const appStore = {
  setActiveView: (activeView: string) => useAppStore.getState().setActiveView(activeView),
  setTheme: (theme: AppStoreState["theme"]) => useAppStore.getState().setTheme(theme),
  setGlobalSearch: (globalSearch: string) => useAppStore.getState().setGlobalSearch(globalSearch),
  resetTransientState: () => useAppStore.getState().resetTransientState(),
};
