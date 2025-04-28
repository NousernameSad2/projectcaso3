'use client'; // Keep as client component for QueryClientProvider

import React from 'react';
// Remove server-side imports - no longer needed here
import Header from '@/components/layout/Header';
import { Toaster } from "@/components/ui/sonner"
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'; 
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'; 
// Remove AuthWrapper import
// import AuthWrapper from './AuthWrapper'; 

// TEMPORARY LAYOUT - Includes Header for navigation but no auth checks yet.
// AppLayoutClient renamed to AppLayout as it's no longer strictly client

// Create a client
// We need to ensure this client is only created once per application instance.
// Storing it in a module-level variable works for this purpose.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Default query options if needed, e.g., staleTime
      staleTime: 1000 * 60 * 5, // 5 minutes
    },
  },
});

// Component is just a standard function component now
export default function AppLayout({ children }: { children: React.ReactNode }) {
    // No auth logic here

    return (
        // Remove AuthWrapper
        // <AuthWrapper>
            <QueryClientProvider client={queryClient}>
                <div className="flex min-h-screen flex-col">
                    <Header />
                    <main className="flex-1 p-4 md:p-6 lg:p-8">
                        {children}
                    </main>
                    <Toaster richColors />
                </div>
                <ReactQueryDevtools initialIsOpen={false} /> 
            </QueryClientProvider>
        // </AuthWrapper>
    );
} 