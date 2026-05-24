import {
  ClerkProvider,
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "./providers/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Readable — Research companion",
  description:
    "Ingest arXiv papers, build a retrieval graph, and get persona-aware summaries and grounded Q&A.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ClerkProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <header className="fixed right-4 top-4 z-50 flex items-center gap-2 rounded-full border border-white/10 bg-zinc-950/80 px-3 py-2 text-sm text-white shadow-lg backdrop-blur dark:border-white/10 dark:bg-neutral-950/80">
              <Show when="signed-out">
                <SignInButton>
                  <button className="rounded-full px-3 py-1.5 text-zinc-200 transition hover:bg-white/10 hover:text-white">
                    Sign in
                  </button>
                </SignInButton>
                <SignUpButton>
                  <button className="rounded-full bg-white px-3 py-1.5 font-medium text-zinc-950 transition hover:bg-zinc-200">
                    Sign up
                  </button>
                </SignUpButton>
              </Show>
              <Show when="signed-in">
                <UserButton />
              </Show>
            </header>
            {children}
          </ThemeProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
