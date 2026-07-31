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
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-950">
        <nav className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-8 sm:px-8">
            <Link href="/" className="shrink-0 text-base font-bold tracking-tight text-slate-950">
              Job Autopilot
            </Link>
            <div className="-mx-1 flex gap-1 overflow-x-auto pb-1 sm:mx-0 sm:pb-0">
              <Link href="/" className="min-h-11 shrink-0 rounded-lg px-3 py-3 text-sm font-medium text-slate-950 hover:bg-slate-100">
                Dashboard
              </Link>
              <Link href="/profile" className="min-h-11 shrink-0 rounded-lg px-3 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-950">
                Profile &amp; Filters
              </Link>
              <Link href="/autofill" className="min-h-11 shrink-0 rounded-lg px-3 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-950">
                Auto-fill
              </Link>
              <Link href="/applications" className="min-h-11 shrink-0 rounded-lg px-3 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-950">
                Applications
              </Link>
            </div>
          </div>
        </nav>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
