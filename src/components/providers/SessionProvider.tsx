'use client';

import { SessionProvider } from 'next-auth/react';
import React from 'react';

interface ProviderProps {
  children: React.ReactNode;
}

export default function Provider({ children }: ProviderProps) {
  return <SessionProvider>{children}</SessionProvider>;
} 