import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { clearSessionStorage } from '@/lib/session';

export interface AuthState {
  user: {
    id: string;
    email: string;
    name: string;
    avatar?: string | null;
    phone?: string | null;
    role: 'ADMIN' | 'HOTEL_STAFF' | 'HOTEL_FD' | 'RESTAURANT_STAFF' | 'HOUSEKEEPER';
  } | null;
  token: string | null;
  lastActivityAt: number | null;
  isAuthenticated: boolean;
  login: (user: AuthState['user'], token: string) => void;
  updateUser: (patch: Partial<NonNullable<AuthState['user']>>) => void;
  logout: () => void;
  touchActivity: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      lastActivityAt: null,
      isAuthenticated: false,
      login: (user, token) => {
        const now = Date.now();
        set({
          user,
          token,
          lastActivityAt: now,
          isAuthenticated: true,
        });
      },
      updateUser: (patch) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...patch } : null,
        })),
      logout: () => {
        clearSessionStorage();
        set({
          user: null,
          token: null,
          lastActivityAt: null,
          isAuthenticated: false,
        });
      },
      touchActivity: () => set({ lastActivityAt: Date.now() }),
    }),
    {
      name: 'erp-auth-storage',
    }
  )
);

export {
  canAccessHotel,
  canAccessRestaurant,
  canAccessAdmin,
  canAccessInventory,
  canManageRoomInventory,
  canPerformRoomCleaning,
  isHotelFrontDesk,
  isRoomsViewOnly,
  isHousekeeper,
  formatRoleLabel,
} from '@/lib/roles';
