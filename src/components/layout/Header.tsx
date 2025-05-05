'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { cn } from "@/lib/utils";
import { UserRole } from '@prisma/client';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
    SheetClose,
} from "@/components/ui/sheet";
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
  BookUser,
  Menu
} from 'lucide-react';

// Define all possible nav items
const allNavItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/equipment', label: 'Equipment', icon: HardDrive },
  { href: '/classes', label: 'Classes', icon: BookUser },
  { href: '/my-borrows', label: 'My Borrows', icon: ClipboardList },
  { href: '/deficiencies', label: 'Deficiencies', icon: TriangleAlert },
  { href: '/reports', label: 'Reports', icon: AreaChart, adminOnly: true },
  { href: '/users', label: 'Manage Users', icon: Users, adminOnly: true },
];

const profileNavItem = { href: '/profile', label: 'My Profile', icon: UserCircle };

export default function Header() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const pathname = usePathname();
    const [isSheetOpen, setIsSheetOpen] = useState(false);
    
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
                    <Link href="/" className="mr-6 flex items-center space-x-2" legacyBehavior>
                        <a>
                            <Building2 className="h-6 w-6 text-primary" />
                            <span className="font-bold sm:inline-block">
                                E-Bridge
                            </span>
                        </a>
                    </Link>
                    <div className="flex items-center space-x-4">
                        {/* Placeholder or spinner could go here */}
                    </div>
                </div>
            </header>
        );
    }

    // Helper function to close sheet
    const closeSheet = () => setIsSheetOpen(false);

    return (
        <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="container flex h-16 max-w-screen-2xl items-center justify-between">
                {/* Logo and Title */}
                <Link href="/" className="mr-6 flex items-center space-x-2" legacyBehavior>
                    <a>
                        <Building2 className="h-6 w-6 text-primary" />
                        <span className="font-bold sm:inline-block">
                            E-Bridge
                        </span>
                    </a>
                </Link>

                {/* Centered Navigation Links (Desktop) - Already hidden on small screens */}
                <nav className="hidden md:flex flex-1 items-center justify-center space-x-1 lg:space-x-2">
                    {accessibleNavItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
                        return (
                            <Link
                                key={`desktop-${item.href}`}
                                href={item.href}
                                className={cn(
                                    "flex items-center space-x-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                                    isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                                )}
                                legacyBehavior>
                                <Icon className="h-4 w-4" />
                                <span>{item.label}</span>
                            </Link>
                        );
                    })}
                </nav>

                {/* Right side elements (Profile/Login/Logout + Mobile Menu Trigger) */}
                <div className="flex items-center space-x-2 md:space-x-4">
                     {/* Profile/Login/Logout Buttons (visible on desktop) */}
                    <div className="hidden md:flex items-center space-x-4">
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
                                    legacyBehavior>
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
                            (<Button asChild variant="outline" size="sm">
                                <Link href="/login" className="flex items-center space-x-2" legacyBehavior>
                                    <LogIn className="h-4 w-4" />
                                    <span>Login</span>
                                </Link>
                            </Button>)
                        )}
                    </div>

                    {/* Mobile Menu Trigger (visible only on small screens) */}
                    <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
                        <SheetTrigger asChild>
                            <Button variant="ghost" size="icon" className="md:hidden">
                                <Menu className="h-6 w-6" />
                                <span className="sr-only">Toggle Menu</span>
                            </Button>
                        </SheetTrigger>
                        <SheetContent side="left" className="w-[280px]"> 
                            <SheetHeader className="mb-6">
                                <SheetTitle className="flex items-center space-x-2">
                                    <Building2 className="h-5 w-5 text-primary" />
                                    <span>E-Bridge Menu</span>
                                </SheetTitle>
                                {/* Optional Description */} 
                                {/* <SheetDescription>Navigation</SheetDescription> */} 
                            </SheetHeader>
                            <nav className="flex flex-col space-y-2">
                                 {/* Mobile Navigation Links */}
                                {accessibleNavItems.map((item) => {
                                    const Icon = item.icon;
                                    const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
                                    return (
                                        <SheetClose asChild key={`mobile-${item.href}`}>
                                            <Link
                                                href={item.href}
                                                className={cn(
                                                    "flex items-center space-x-3 rounded-md px-3 py-2 text-base font-medium transition-colors",
                                                    isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"
                                                )}
                                                // Close sheet on click
                                                onClick={closeSheet}
                                                legacyBehavior>
                                                <Icon className="h-5 w-5" />
                                                <span>{item.label}</span>
                                            </Link>
                                        </SheetClose>
                                    );
                                })}
                                 {/* Mobile Profile/Logout/Login */} 
                                {isAuthenticated ? (
                                    <>
                                        <SheetClose asChild> 
                                            <Link
                                                href={profileNavItem.href}
                                                className={cn(
                                                     "flex items-center space-x-3 rounded-md px-3 py-2 text-base font-medium transition-colors",
                                                     pathname === profileNavItem.href ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"
                                                )}
                                                onClick={closeSheet}
                                                legacyBehavior>
                                                <profileNavItem.icon className="h-5 w-5" />
                                                <span>{profileNavItem.label}</span>
                                            </Link>
                                        </SheetClose>
                                        <Button 
                                            variant="ghost" 
                                            onClick={() => { handleLogout(); closeSheet(); }} 
                                            className="flex justify-start items-center space-x-3 rounded-md px-3 py-2 text-base font-medium text-destructive hover:bg-destructive/10 hover:text-destructive"
                                        >
                                            <LogOut className="h-5 w-5" />
                                            <span>Logout</span>
                                        </Button>
                                    </>
                                ) : (
                                    <SheetClose asChild> 
                                         <Link
                                             href="/login"
                                             className="flex items-center space-x-3 rounded-md px-3 py-2 text-base font-medium transition-colors text-muted-foreground hover:bg-accent hover:text-foreground"
                                             onClick={closeSheet}
                                             legacyBehavior>
                                             <LogIn className="h-5 w-5" />
                                            <span>Login</span>
                                        </Link>
                                    </SheetClose>
                                )}
                            </nav>
                        </SheetContent>
                    </Sheet>
                </div> 
            </div>
        </header>
    );
} 