"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

/* Claro / Oscuro / Sistema. Vive en el pie del sidebar, junto a la campana. */
const OPCIONES = [
  { id: "light", nombre: "Claro", icono: Sun },
  { id: "dark", nombre: "Oscuro", icono: Moon },
  { id: "system", nombre: "Sistema", icono: Monitor },
] as const;

/* Sin suscripción real: solo distingue servidor (false) de cliente (true). Se usa
   useSyncExternalStore en vez de un useState+useEffect porque eso último es un
   setState dentro de un efecto, que dispara un render en cascada. */
const SIN_SUSCRIPCION = () => () => {};

export function TemaToggle() {
  const { theme, setTheme } = useTheme();
  /* El tema real solo se conoce en el navegador: pintarlo en el servidor haría
     que el botón marcado no coincidiera tras hidratar. Hasta entonces se
     renderiza el hueco, para que la barra no salte de tamaño. */
  const montado = useSyncExternalStore(
    SIN_SUSCRIPCION,
    () => true,
    () => false,
  );

  if (!montado) return <div className="h-8" aria-hidden="true" />;

  return (
    <div
      role="group"
      aria-label="Tema de la interfaz"
      className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5"
    >
      {OPCIONES.map(({ id, nombre, icono: Icono }) => (
        <button
          key={id}
          type="button"
          onClick={() => setTheme(id)}
          aria-pressed={theme === id}
          title={nombre}
          className={cn(
            "flex flex-1 items-center justify-center rounded-md py-1.5 transition-colors",
            theme === id
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icono className="size-4" strokeWidth={1.9} aria-hidden="true" />
          <span className="sr-only">{nombre}</span>
        </button>
      ))}
    </div>
  );
}
