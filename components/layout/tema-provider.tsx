"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/* `next-themes` es un componente de cliente y el layout raíz es de servidor, así
   que necesita este puente. Ya estaba instalado (lo usaba el Toaster para elegir
   sus colores), pero nunca se había montado el provider: el bloque `.dark` de
   globals.css existía sin que nadie pusiera la clase que lo activa. */
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
