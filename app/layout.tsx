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
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('theme');
                  var isDark = theme === 'dark' ||
                    (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches) ||
                    (!theme);
                  document.documentElement.classList.toggle('dark', isDark);
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="antialiased">
        <ThemeProvider>
          {children}
          <FeedbackButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
