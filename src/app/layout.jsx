import '../client/index.css';

export const metadata = {
  title: 'Time Tracker',
  description: 'Internal task management and reliable time tracking',
  icons: { icon: '/favicon.svg' },
};
export const viewport = { themeColor: '#10131c', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
