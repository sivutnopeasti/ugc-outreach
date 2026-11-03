import './globals.css';

export const metadata = {
  title: 'UGC Suomi Outreach',
  description: 'Etsi heikon Instagramin yrityksiä ja kutsu ne hakemaan sisällöntuottajaa',
};

export default function RootLayout({ children }) {
  return (
    <html lang="fi">
      <body>{children}</body>
    </html>
  );
}
