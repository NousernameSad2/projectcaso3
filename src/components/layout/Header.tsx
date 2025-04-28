'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { cn } from "@/lib/utils";
import { UserRole } from '@prisma/client';
import {
  LayoutDashboard,
  HardDrive,
  Users,
  ClipboardList,
  TriangleAlert,
  AreaChart,
  UserCircle,
  LogOut,
  LogIn,
  Building2,
  BookUser
} from 'lucide-react';

// Define all possible nav items
const allNavItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/equipment', label: 'Equipment', icon: HardDrive },
  { href: '/classes', label: 'Classes', icon: BookUser },
  { href: '/my-borrows', label: 'Borrows', icon: ClipboardList },
  { href: '/deficiencies', label: 'Deficiencies', icon: TriangleAlert },
  { href: '/reports', label: 'Reports', icon: AreaChart, adminOnly: true },
  { href: '/users', label: 'Manage Users', icon: Users, adminOnly: true },
];

const profileNavItem = { href: '/profile', label: 'My Profile', icon: UserCircle };

export default function Header() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const pathname = usePathname();
    
    // Extract user role
    const userRole = session?.user?.role as UserRole | undefined;
    
    // Determine authentication status and privilege
    const isAuthenticated = status === 'authenticated';
    const isPrivilegedUser = userRole === UserRole.STAFF || userRole === UserRole.FACULTY;
    const isLoading = status === 'loading'; 

    // Use next-auth signOut for logout
    const handleLogout = async () => {
        await signOut({ redirect: false }); 
        router.push('/login'); 
    };

    // Filter nav items based on role
    const accessibleNavItems = allNavItems.filter(item => {
        // Show item if it's not adminOnly OR if the user is privileged
        return !item.adminOnly || isPrivilegedUser;
    });

    // Handle loading state (optional, show minimal header or loading indicator)
    if (isLoading) {
        return (
            <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <div className="container flex h-16 max-w-screen-2xl items-center justify-between">
                    {/* Logo and Title */}
                    <Link href="/" className="mr-6 flex items-center space-x-2">
                        <Building2 className="h-6 w-6 text-primary" />
                        <span className="font-bold sm:inline-block">
                            E-Bridge
                        </span>
                    </Link>
                    <div className="flex items-center space-x-4">
                        {/* Placeholder or spinner could go here */}
                    </div>
                </div>
            </header>
        );
    }

    return (
        <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="container flex h-16 max-w-screen-2xl items-center justify-between">
                {/* Logo and Title */}
                <Link href="/" className="mr-6 flex items-center space-x-2">
                    <Building2 className="h-6 w-6 text-primary" />
                    <span className="font-bold sm:inline-block">
                        E-Bridge
                    </span>
                </Link>

                {/* Centered Navigation Links (Uses filtered accessibleNavItems) */}
                <nav className="hidden md:flex flex-1 items-center justify-center space-x-1 lg:space-x-2">
                    {accessibleNavItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={cn(
                                    "flex items-center space-x-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                                    isActive
                                        ? "bg-primary/10 text-primary"
                                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                                )}
                            >
                                <Icon className="h-4 w-4" />
                                <span>{item.label}</span>
                            </Link>
                        );
                    })}
                </nav>

                {/* Profile and Logout/Login */}
                <div className="flex items-center space-x-4">
                    {isAuthenticated ? (
                        <>
                            {/* Profile Link */}
                            <Link
                                href={profileNavItem.href}
                                className={cn(
                                    "flex items-center space-x-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                                    pathname === profileNavItem.href
                                        ? "bg-primary/10 text-primary"
                                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                                )}
                            >
                                <profileNavItem.icon className="h-4 w-4" />
                                <span>{profileNavItem.label}</span>
                            </Link>
                            {/* Logout Button */}
                            <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={handleLogout} 
                                title="Logout"
                                className="text-muted-foreground hover:text-foreground hover:bg-accent/50"
                            >
                                <LogOut className="h-5 w-5" />
                                <span className="sr-only">Logout</span>
                            </Button>
                        </>
                    ) : (
                        /* Login Button */
                        <Button asChild variant="outline" size="sm">
                            <Link href="/login" className="flex items-center space-x-2">
                                <LogIn className="h-4 w-4" />
                                <span>Login</span>
                            </Link>
                        </Button>
                    )}
                </div>
            </div>
        </header>
    );
} 