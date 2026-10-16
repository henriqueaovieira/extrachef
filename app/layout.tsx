
import { LoadingSkeleton } from '@/app/components/ui';
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import PwaInstallPrompt from "@/app/components/pwa-install-prompt";
import NotificationExperience from "@/app/components/notification-experience";
import SessionGuard from "@/app/components/session-guard";
import { Suspense } from "react";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "ExtraChef | Plantões para restaurantes",
    template: "%s | ExtraChef",
  },
  description: "Conecte restaurantes e profissionais para plantões no setor de alimentação.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ExtraChef",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#C95E32",
  colorScheme: "light",
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Suspense fallback={<LoadingSkeleton label="Carregando..." />}>
          <NotificationExperience>
            <SessionGuard>{children}</SessionGuard>
          </NotificationExperience>
        </Suspense>
        <PwaInstallPrompt />
      </body>
    </html>
  );
}
