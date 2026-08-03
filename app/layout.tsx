import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Job Autopilot",
  description: "Match jobs to your resume and draft applications for review.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <nav
          className="border-b px-4 sm:px-8 py-3 flex items-center gap-3 sm:gap-6 overflow-x-auto whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <span className="shrink-0 text-sm sm:text-base font-semibold">Job Autopilot</span>
          <Link
            href="/"
            className="shrink-0 text-xs sm:text-sm text-gray-600 hover:text-gray-900"
          >
            Dashboard
          </Link>
          <Link
            href="/profile"
            className="shrink-0 text-xs sm:text-sm text-gray-600 hover:text-gray-900"
          >
            <span className="sm:hidden">Profile</span>
            <span className="hidden sm:inline">Profile & Filters</span>
          </Link>
          <Link
            href="/autofill"
            className="shrink-0 text-xs sm:text-sm text-gray-600 hover:text-gray-900"
          >
            Auto-fill
          </Link>
          <Link
            href="/applications"
            className="shrink-0 text-xs sm:text-sm text-gray-600 hover:text-gray-900"
          >
            Applications
          </Link>
        </nav>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
