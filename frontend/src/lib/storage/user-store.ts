import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UserState {
  currentUser: string | null;
  mainUser: string | null;
  allUsers: string[];
  isLabMode: boolean;
  
  setCurrentUser: (username: string | null) => void;
  setMainUser: (username: string) => void;
  setAllUsers: (users: string[]) => void;
  toggleLabMode: () => void;
  clearUser: () => void;
}

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      currentUser: null,
      mainUser: null,
      allUsers: [],
      isLabMode: false,
      
      setCurrentUser: (username) => set({ currentUser: username, isLabMode: false }),
      
      setMainUser: (username) => set({ mainUser: username }),
      
      setAllUsers: (users) => set({ allUsers: users }),
      
      toggleLabMode: () => set((state) => ({ isLabMode: !state.isLabMode })),
      
      clearUser: () => set({ 
        currentUser: null, 
        mainUser: null, 
        allUsers: [], 
        isLabMode: false 
      }),
    }),
    {
      name: "research-os-user",
      partialize: (state) => ({
        mainUser: state.mainUser,
      }),
    }
  )
);
