import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}