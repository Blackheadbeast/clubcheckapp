import type { Metadata } from "next";
import "./globals.css";
import FeedbackButton from "@/components/FeedbackButton";
import ThemeProvider from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: 'ClubCheck - Gym Management Made Simple',
  description: 'Members, check-ins, payments, and staff — organized in one place. Built for boutique gyms. Set up in 10 minutes.',
  icons: {
    icon: '/favicon.ico',
  },
  metadataBase: new URL('https://clubcheckapp.com'),
  openGraph: {
    title: 'ClubCheck - Gym Management Made Simple',
    description: 'Members, check-ins, payments, and staff — organized in one place. Built for boutique gyms.',
    url: 'https://clubcheckapp.com',
    siteName: 'ClubCheck',
    locale: 'en_US',
    type: 'website',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'ClubCheck - Gym Management Made Simple',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClubCheck - Gym Management Made Simple',
    description: 'Members, check-ins, payments, and staff — organized in one place. Built for boutique gyms.',
    images: ['/og-image.png'],
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
