import type { Metadata } from "next";
import "./globals.css";
import "@/styles/viewer.css";

export const metadata: Metadata = {
  title: "Anatomia Cirúrgica em Mastologia",
  description: "Atlas cirúrgico interativo para cortes anatômicos e etapas em mastologia.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
