import type { Metadata } from "next";
import "./globals.css";
import FeedbackButton from "@/components/FeedbackButton";
import ThemeProvider from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: 'ClubCheck - Gym Management Made Simple',
  description: 'Stop wrestling with spreadsheets. Start managing members, tracking check-ins, and growing your gym—all in one beautiful platform.',
  icons: {
    icon: '/favicon.ico',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased bg-dark text-gray-100 dark:bg-dark dark:text-gray-100 light:bg-light-bg light:text-gray-900">
        <ThemeProvider>
          {children}
          <FeedbackButton />
        </ThemeProvider>
      </body>
    </html>
  );
}