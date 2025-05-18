'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useRef } from 'react';
import { useAuthStore, AuthUser, AuthState } from '@/stores/authStore';

// Define an interface for the expected shape of session.user
interface SessionUserWithDetails {
  id: string;
  name?: string | null;
  email?: string | null;
  role: string; // Or your actual UserRole enum/type
}

export default function AuthStoreSync() {
  const { data: session, status } = useSession();
  const setUser = useAuthStore((state: AuthState) => state.setUser);
  const storeInitialized = useRef(false);

  useEffect(() => {
    console.log("AuthStoreSync Effect: status=", status, "storeInitialized=", storeInitialized.current, "session=", session);
    
    if (status !== 'loading') { 
       const currentUser = session?.user ? {
         userId: (session.user as SessionUserWithDetails).id, // Map id to userId
         name: session.user.name,
         email: session.user.email,
         role: (session.user as SessionUserWithDetails).role
       } as AuthUser : null; 

       // Simple sync: always update store when session changes after initial load
       // Prevents potential stale state if store isn't updated on subsequent session changes
       if (!storeInitialized.current) {
            console.log("AuthStoreSync: ==> Initializing store with user:", currentUser);
            setUser(currentUser);
            storeInitialized.current = true; 
       } else {
           // Check if store needs update (basic stringify comparison)
           // Get current user from store *without* subscribing to prevent loops
           const storeUser = useAuthStore.getState().user;
           if (JSON.stringify(storeUser) !== JSON.stringify(currentUser)) {
               console.log("AuthStoreSync: ==> Updating store with user:", currentUser);
               setUser(currentUser);
           } else {
               console.log("AuthStoreSync: Store user matches session user, no update needed.");
           }
       }
    }
  }, [session, status, setUser]);

  return null;
} 