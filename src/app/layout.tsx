import type { Metadata } from "next";
import { Figtree, Geist_Mono } from "next/font/google";
import { AuthGuard } from "@/components/auth-guard";
import { NavigationProgressBar } from "@/components/navigation-progress-bar";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/providers/auth-provider";
import { QueryProvider } from "@/providers/query-provider";
import "./globals.css";

const figtreeSans = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "The Builder's Ledger",
  description: "Admin and invoicing platform for residential builders",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${figtreeSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <QueryProvider>
          <AuthProvider>
            <NavigationProgressBar />
            <AuthGuard>{children}</AuthGuard>
            <Toaster richColors />
          </AuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
