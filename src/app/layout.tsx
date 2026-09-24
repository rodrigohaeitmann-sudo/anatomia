import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import "./globals.css";
import "@/styles/viewer.css";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: "Anatomia Cirúrgica em Mastologia",
  description: "Atlas cirúrgico interativo para cortes anatômicos e etapas em mastologia.",
  manifest: `${basePath}/manifest.webmanifest`,
  applicationName: "Anatomia Mama",
  icons: {
    icon: [
      { url: `${basePath}/favicon.png`, sizes: "32x32", type: "image/png" },
      { url: `${basePath}/icons/icon-192.png`, sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: `${basePath}/icons/apple-touch-icon.png`, sizes: "180x180" }],
  },
  appleWebApp: { capable: true, title: "Anatomia Mama", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#020617",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
