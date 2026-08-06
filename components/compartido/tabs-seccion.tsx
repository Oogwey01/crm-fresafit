"use client";

import { cn } from "@/lib/utils";

/* Las pestañas con subrayado que estrenó Canales, ahora para todo el CRM.

   Se reparten el trabajo con ControlSegmentado: esto CAMBIA de sección (son
   pantallas distintas, cada una con su tabla y sus acciones); el segmentado
   FILTRA o reencuadra lo que ya estás viendo (pendientes/todos,
   desglosado/agrupado). Antes ambos usos se veían igual y no había manera de
   saber, de un vistazo, si un botón te movía de pantalla o te quitaba filas.

   La misma barra sirve en el teléfono: cuando los nombres no caben se desliza
   de lado. Cada módulo montaba además un Select para móvil —dos controles que
   mantener, y el desplegable escondía dónde estabas parado—. */

/* Compartidas con TabsCanales, que usa <Link> porque allá cada plataforma es
   una ruta propia (así no se repinta el módulo entero al cambiar de pestaña). */
export const CLASE_NAV_TABS = "-mx-1 flex gap-1 overflow-x-auto border-b pb-px";

export function claseTab(activo: boolean) {
  return cn(
    "shrink-0 rounded-t-lg px-3.5 py-2 text-[13.5px] transition-colors",
    activo
      ? "border-b-2 border-primary font-semibold text-foreground"
      : "font-medium text-muted-foreground hover:text-foreground",
  );
}

export function TabsSeccion<T extends string>({
  opciones,
  valor,
  onCambio,
  className,
}: {
  opciones: readonly (readonly [T, string])[];
  valor: T;
  onCambio: (v: T) => void;
  className?: string;
}) {
  return (
    <nav className={cn(CLASE_NAV_TABS, className)}>
      {opciones.map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onCambio(id)}
          aria-current={valor === id || undefined}
          className={claseTab(valor === id)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
