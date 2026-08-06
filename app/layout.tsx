import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Space_Grotesk, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/layout/tema-provider";

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
    /* suppressHydrationWarning: next-themes escribe la clase del tema en <html>
       antes de que React hidrate, así que el HTML del servidor y el del cliente
       difieren siempre en ese atributo. Es el patrón oficial de la librería. */
    <html
      lang="es"
      suppressHydrationWarning
      className={`${instrumentSans.variable} ${spaceGrotesk.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        {/* El bloque `.dark` de globals.css ya existía; faltaba quien pusiera la
            clase. `defaultTheme="system"` respeta la preferencia del equipo sin
            obligar a nadie a elegir. */}
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
          <Toaster richColors position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
