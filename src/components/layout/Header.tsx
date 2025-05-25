'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { cn } from "@/lib/utils";
import { UserRole } from '@prisma/client';
import {
    Sheet,
    SheetContent,
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
  Menu,
  ScrollText,
  Info,
} from 'lucide-react';

// --- Navigation Item Definitions ---

const mainNavLinks = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, adminOnly: false },
  { href: '/equipment', label: 'Equipment', icon: HardDrive, adminOnly: false },
  { href: '/classes', label: 'Classes', icon: BookUser, adminOnly: false },
  { href: '/my-borrows', label: 'My Borrows', icon: ClipboardList, adminOnly: false },
  { href: '/deficiencies', label: 'Deficiencies', icon: TriangleAlert, adminOnly: false },
  { href: '/reports', label: 'Reports', icon: AreaChart, adminOnly: true },
  { href: '/users', label: 'Manage Users', icon: Users, adminOnly: true },
];

const aboutLink = { href: '/about', label: 'About', icon: Info };
const profileLink = { href: '/profile', label: 'My Profile', icon: UserCircle };
const borrowRequestsLink = { href: '/borrow-requests', label: 'Borrow Requests', icon: ScrollText, adminOnly: true };

// --- Helper Functions for Styling --- 

const getDesktopNavLinkClasses = (isActive: boolean, isIconOnly: boolean = false) => cn(
  "flex items-center justify-center transition-colors text-sm font-medium rounded-md",
  isIconOnly ? "h-9 w-9 p-0" : "space-x-2 px-3 py-2",
  isActive 
    ? "bg-primary/10 text-primary"
    : "text-muted-foreground hover:bg-accent/50 hover:text-primary/80"
);

const getMobileNavLinkClasses = (isActive: boolean) => cn(
  "flex items-center space-x-3 rounded-md px-3 py-2.5 text-base font-medium transition-colors",
  isActive
    ? "bg-primary/10 text-primary"
    : "text-muted-foreground hover:bg-accent hover:text-primary/90"
);

// --- Header Component --- 

export default function Header() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const pathname = usePathname();
    const [isSheetOpen, setIsSheetOpen] = useState(false);
    const [pendingUsersCount, setPendingUsersCount] = useState(0);

    const userRole = session?.user?.role as UserRole | undefined;
    const isAuthenticated = status === 'authenticated';
    const isPrivilegedUser = isAuthenticated && (userRole === UserRole.STAFF || userRole === UserRole.FACULTY);
    const isLoading = status === 'loading';

    useEffect(() => {
        if (isPrivilegedUser && session?.accessToken) {
            fetch('/api/users?status=PENDING_APPROVAL', {
                headers: { Authorization: `Bearer ${session.accessToken}` },
            })
            .then(res => res.ok ? res.json() : Promise.reject(new Error('Failed to fetch count')))
            .then(data => setPendingUsersCount(data.count))
            .catch(error => console.error('Error fetching pending users count:', error));
        }
    }, [session, isPrivilegedUser]);

    const handleLogout = async () => {
        closeSheet();
        await signOut({ redirect: false });
        router.push('/login');
    };

    const closeSheet = () => setIsSheetOpen(false);

    const visibleMainNavLinks = mainNavLinks.filter(link => !link.adminOnly || isPrivilegedUser);

    if (isLoading) {
        return (
            <header className="sticky top-0 z-50 w-full border-b bg-[hsl(var(--header-background))] backdrop-blur-lg">
                <div className="container mx-auto flex h-16 items-center justify-between px-4 md:px-6">
                    <div className="h-6 w-24 rounded bg-muted-foreground/20 animate-pulse"></div>
                    <div className="h-6 w-32 rounded bg-muted-foreground/20 animate-pulse"></div>
                </div>
            </header>
        );
    }

    return (
        <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-[hsl(var(--header-background))] backdrop-blur-lg">
            <div className="container mx-auto flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
                <div className="flex items-center">
                    <Link href="/" className="flex items-center space-x-2 shrink-0 mr-4">
                        <Building2 className="h-6 w-6 text-primary" />
                        <span className="font-bold text-lg">E-Bridge</span>
                    </Link>
                    <Link href={aboutLink.href} className={getDesktopNavLinkClasses(pathname === aboutLink.href, true)} title={aboutLink.label}>
                        <aboutLink.icon className="h-5 w-5" />
                        <span className="sr-only">{aboutLink.label}</span>
                    </Link>
                </div>

                <nav className="hidden md:flex flex-1 items-center justify-center space-x-1 lg:space-x-2">
                    {visibleMainNavLinks.map(link => (
                        <Link 
                            key={`desktop-${link.href}`}
                            href={link.href}
                            className={getDesktopNavLinkClasses(pathname.startsWith(link.href) && (link.href === '/' ? pathname === '/' : true))}
                        >
                            <link.icon className="h-4 w-4" />
                            <span>{link.label}</span>
                            {link.label === 'Manage Users' && pendingUsersCount > 0 && (
                                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-xs font-semibold text-white">
                                    {pendingUsersCount}
                                </span>
                            )}
                        </Link>
                    ))}
                </nav>

                <div className="hidden md:flex items-center space-x-1 lg:space-x-1.5 shrink-0 ml-6">
                    {isPrivilegedUser && borrowRequestsLink && (
                        <Link 
                            href={borrowRequestsLink.href} 
                            className={getDesktopNavLinkClasses(pathname === borrowRequestsLink.href, true)} 
                            title={borrowRequestsLink.label}
                        >
                            <borrowRequestsLink.icon className="h-5 w-5" />
                            <span className="sr-only">{borrowRequestsLink.label}</span>
                        </Link>
                    )}
                    {isAuthenticated ? (
                        <>
                            <Link href={profileLink.href} className={getDesktopNavLinkClasses(pathname === profileLink.href, true)} title={profileLink.label}>
                                <profileLink.icon className="h-5 w-5" />
                                <span className="sr-only">{profileLink.label}</span>
                            </Link>
                            <Button variant="ghost" onClick={handleLogout} className={getDesktopNavLinkClasses(false, true)} title="Logout">
                                <LogOut className="h-5 w-5" />
                                <span className="sr-only">Logout</span>
                            </Button>
                        </>
                    ) : (
                        <Button asChild size="sm" className={cn(getDesktopNavLinkClasses(false), "px-3 py-2")} >
                            <Link href="/login">
                                <LogIn className="mr-2 h-4 w-4" /> Login
                            </Link>
                        </Button>
                    )}
                </div>

                <div className="md:hidden flex items-center">
                    <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
                        <SheetTrigger asChild>
                            <Button variant="ghost" size="icon">
                                <Menu className="h-6 w-6" />
                                <span className="sr-only">Toggle Menu</span>
                            </Button>
                        </SheetTrigger>
                        <SheetContent side="left" className="w-[280px] sm:w-[320px] p-0">
                            <SheetHeader className="border-b p-4">
                                <SheetTitle className="flex items-center space-x-2">
                                    <Building2 className="h-6 w-6 text-primary" />
                                    <span className="text-lg font-semibold">E-Bridge Menu</span>
                                </SheetTitle>
                            </SheetHeader>
                            <nav className="flex flex-col space-y-1 p-3">
                                {visibleMainNavLinks.map(link => (
                                    <SheetClose asChild key={`mobile-${link.href}`}>
                                        <Link href={link.href} onClick={closeSheet} className={getMobileNavLinkClasses(pathname.startsWith(link.href) && (link.href === '/' ? pathname === '/' : true))}>
                                            <link.icon className="h-5 w-5" />
                                            <span>{link.label}</span>
                                            {link.label === 'Manage Users' && pendingUsersCount > 0 && (
                                                 <span className="ml-auto inline-flex items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-xs font-semibold text-white">
                                                    {pendingUsersCount}
                                                </span>
                                            )}
                                        </Link>
                                    </SheetClose>
                                ))}
                                
                                <hr className="my-2 border-border/60"/>

                                {isPrivilegedUser && borrowRequestsLink && (
                                    <SheetClose asChild>
                                        <Link href={borrowRequestsLink.href} onClick={closeSheet} className={getMobileNavLinkClasses(pathname === borrowRequestsLink.href)}>
                                            <borrowRequestsLink.icon className="h-5 w-5" />
                                            <span>{borrowRequestsLink.label}</span>
                                        </Link>
                                    </SheetClose>
                                )}
                                <SheetClose asChild>
                                    <Link href={aboutLink.href} onClick={closeSheet} className={getMobileNavLinkClasses(pathname === aboutLink.href)}>
                                        <aboutLink.icon className="h-5 w-5" />
                                        <span>{aboutLink.label}</span>
                                    </Link>
                                </SheetClose>
                                
                                {isAuthenticated ? (
                                    <>
                                        <hr className="my-2 border-border/60"/>
                                        <SheetClose asChild>
                                            <Link href={profileLink.href} onClick={closeSheet} className={getMobileNavLinkClasses(pathname === profileLink.href)}>
                                                <profileLink.icon className="h-5 w-5" />
                                                <span>{profileLink.label}</span>
                                            </Link>
                                        </SheetClose>
                                        <Button 
                                            variant="ghost" 
                                            onClick={handleLogout} 
                                            className={cn(getMobileNavLinkClasses(false), "text-destructive hover:bg-destructive/10 justify-start w-full")}
                                        >
                                            <LogOut className="h-5 w-5 mr-3" />
                                            <span>Logout</span>
                                        </Button>
                                    </>
                                ) : (
                                    <>
                                        <hr className="my-2 border-border/60"/>
                                        <SheetClose asChild>
                                            <Link href="/login" onClick={closeSheet} className={getMobileNavLinkClasses(false)}>
                                                <LogIn className="h-5 w-5 mr-3" />
                                                <span>Login</span>
                                            </Link>
                                        </SheetClose>
                                    </>
                                )}
                            </nav>
                        </SheetContent>
                    </Sheet>
                </div>
            </div>
        </header>
    );
} 