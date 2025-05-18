import type { Metadata } from "next";
import { Inter } from 'next/font/google'; // Re-import Inter
import "./globals.css";
// Import ThemeProvider directly from next-themes
import { ThemeProvider } from "next-themes"; 
// import { cn } from "@/lib/utils"; // Removed unused cn import
import SessionProvider from "@/components/providers/SessionProvider"; // Use SessionProvider instead of the non-existent AuthProvider
import { Toaster } from "@/components/ui/sonner"; // Import Toaster
import "react-day-picker/style.css"; // Import react-day-picker default CSS
// Remove imports for AuthStoreSync
// import AuthStoreSync from "@/components/providers/AuthStoreSync"; 

// Re-configure Inter font
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter', // Define CSS variable
});

export const metadata: Metadata = {
  title: "DGE Instrument Room | Equipment Management",
  description: "Equipment reservation and management system for the UP DGE Instrument Room",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Re-apply font variable to html className
    <html lang="en" className={`${inter.variable}`} suppressHydrationWarning>
      <head>
        {/* Next.js will inject necessary head elements here */}
      </head>
      <body className="antialiased">
        {/* <SessionProvider> */}
          {/* <AuthStoreSync /> */} {/* Keep AuthStoreSync for now, remove later if needed */}
          <SessionProvider>
            <ThemeProvider
              attribute="class"
              defaultTheme="system"
              enableSystem
              disableTransitionOnChange
            >
              <Toaster />
          {children}
            </ThemeProvider>
          </SessionProvider>
        {/* </SessionProvider> */}
      </body>
    </html>
  );
}
