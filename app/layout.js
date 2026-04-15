import './globals.css';

export const metadata = {
  title: 'Neural Map',
  description: 'AI-powered knowledge graph explorer',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
