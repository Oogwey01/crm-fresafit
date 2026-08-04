import { formatearFechaHora } from "@/lib/fecha";

/* Línea de estado de la integración, común a las tres páginas de Canales.
   Cuando el canal no está conectado no tiene sentido pintar el resto: se dice
   qué falta y ya. */
export function SinConexion({ nombre }: { nombre: string }) {
  return (
    <p className="rounded-xl border border-dashed p-6 text-center text-[13.5px] text-muted-foreground">
      {nombre} no está conectado. Se conecta desde Inventario.
    </p>
  );
}

export function UltimaSync({ ultimaSync }: { ultimaSync: string | null }) {
  return (
    <span className="text-[12.5px] text-muted-foreground">
      {ultimaSync ? `Sincronizado ${formatearFechaHora(ultimaSync)}` : "Sin sincronizar todavía"}
    </span>
  );
}
