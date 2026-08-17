import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_Bengali } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const notoBengali = Noto_Sans_Bengali({
  variable: "--font-bengali",
  subsets: ["bengali"],
  weight: ["400", "600", "700"],
});

export const metadata: Metadata = {
  title: "RRP Dream Inn ERP",
  description: "Hotel ERP System - RRP Dream Inn Management",
  keywords: ["ERP", "Hotel", "Management", "Booking"],
  authors: [{ name: "RRP Dream Inn" }],
  icons: {
    icon: "/brand-logo.png",
  },
  openGraph: {
    title: "RRP Dream Inn ERP",
    description: "Hotel ERP System for operations and billing.",
    url: "http://localhost:3000",
    siteName: "RRP Dream Inn",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "RRP Dream Inn ERP",
    description: "Hotel ERP System for operations and billing.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${notoBengali.variable} antialiased bg-background text-foreground`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
