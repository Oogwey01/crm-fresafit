import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Space_Grotesk, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const instrumentSans = Instrument_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-heading",
  weight: ["600", "700"],
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Fresafit · Sistema interno",
  description: "CRM interno de Fresafit — tablero de tareas del equipo.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // `cover` habilita env(safe-area-inset-*) para notch/barras del sistema;
  // `resizes-content` recomprime el layout cuando sube el teclado virtual.
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#e84393",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${instrumentSans.variable} ${spaceGrotesk.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        {children}
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
