import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClubCheck - Gym Management",
  description: "Simple gym management for real gyms",
};

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