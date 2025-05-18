import { create } from 'zustand';
// Remove persist imports
// import { persist, createJSONStorage } from 'zustand/middleware';
import { UserRole /*, UserStatus*/ } from '@prisma/client'; // Removed UserStatus import

// Revert to original AuthUser structure if needed, or define one
// Assuming this structure was used before
export interface AuthUser {
    userId: string;
    email: string;
    role: UserRole;
    name: string;
    // status?: UserStatus; // Optional status if stored
}

export interface AuthState { // Export AuthState
    token: string | null; // Keep for now if needed for API headers
    user: AuthUser | null; 
    isAuthenticated: boolean;
    login: (token: string, user: AuthUser) => void; 
    logout: () => void; 
    setUser: (user: AuthUser | null) => void; 
}

// Remove getLocalStorage helper

// Create store WITHOUT persist middleware
export const useAuthStore = create<AuthState>((set, get) => ({
    token: null,
    user: null,
    isAuthenticated: false,
    login: (token, user) => {
        console.log('AuthStore: login action called');
        set({ token, user, isAuthenticated: true });
    },
    logout: () => {
        console.log('AuthStore: logout action called');
        set({ token: null, user: null, isAuthenticated: false });
    },
    setUser: (user) => { 
        const currentState = get();
        console.log('AuthStore: setUser called. New user:', user, 'Current state:', currentState);
        // Determine isAuthenticated based *only* on presence of user from session sync
        const newIsAuthenticated = !!user;
        // Update token based on user? No, token comes from login action.
        // Only update user and isAuthenticated based on session sync
        if (JSON.stringify(currentState.user) !== JSON.stringify(user) || currentState.isAuthenticated !== newIsAuthenticated) {
             set({ user, isAuthenticated: newIsAuthenticated }); // Only set user and derived auth status
             console.log('AuthStore: State *was* updated by setUser.');
        } else {
            console.log('AuthStore: State *not* updated by setUser (user object/auth status seems identical).');
        }
    },
})); 