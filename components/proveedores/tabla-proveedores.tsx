"use client";

import type { Supplier } from "@/lib/types";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import type { ProductoProveedor } from "@/lib/proveedores/tipos";

const COLS = "grid-cols-[minmax(160px,1fr)_100px_130px_180px_90px_100px_minmax(110px,1fr)]";

export function TablaProveedores({
  proveedores,
  productos,
  diasEntregaDefault,
  onEditar,
}: {
  proveedores: Supplier[];
  productos: ProductoProveedor[];
  /* El que se usa cuando el proveedor no tiene el suyo capturado. */
  diasEntregaDefault: number;
  onEditar: (p: Supplier) => void;
}) {
  if (proveedores.length === 0) {
    return (
      <p className="text-sm italic text-muted-foreground">
        Aún no hay proveedores. Da de alta el primero con «+ Nuevo proveedor» (Nancy, Amy, Gina…).
      </p>
    );
  }

  const productosPor = new Map<string, number>();
  for (const p of productos) {
    if (p.proveedor_id) productosPor.set(p.proveedor_id, (productosPor.get(p.proveedor_id) ?? 0) + 1);
  }

  const columnas: Columna<Supplier>[] = [
    {
      clave: "nombre",
      label: "Proveedor",
      esTitulo: true,
      celda: (p) => (
        <div className="flex min-w-0 flex-col">
          <button
            type="button"
            onClick={() => onEditar(p)}
            className="truncate text-left font-medium hover:underline"
            title={p.nombre}
          >
            {p.nombre}
          </button>
          {/* Con la etiqueta puesta: el renglón «Nancy / suerte» sin contexto
              fue justo lo que confundió en la junta. */}
          {p.contacto && (
            <span
              className="truncate text-[12px] text-muted-foreground"
              title={`Contacto: ${p.contacto}`}
            >
              Contacto: {p.contacto}
            </span>
          )}
        </div>
      ),
    },
    {
      clave: "pais",
      label: "País",
      celda: (p) => (
        <div className="truncate" title={p.pais ?? undefined}>
          {p.pais ?? <span className="text-muted-foreground/50">—</span>}
        </div>
      ),
    },
    {
      clave: "telefono",
      label: "Teléfono",
      celda: (p) => (
        <div className="truncate">
          {p.telefono ? (
            <a href={`tel:${p.telefono}`} className="hover:underline">
              {p.telefono}
            </a>
          ) : (
            <span className="text-muted-foreground/50">—</span>
          )}
        </div>
      ),
    },
    {
      clave: "correo",
      label: "Correo",
      celda: (p) => (
        <div className="truncate">
          {p.correo ? (
            <a href={`mailto:${p.correo}`} className="hover:underline">
              {p.correo}
            </a>
          ) : (
            <span className="text-muted-foreground/50">—</span>
          )}
        </div>
      ),
    },
    {
      clave: "productos",
      label: "Productos",
      celda: (p) => <div className="tabular-nums">{productosPor.get(p.id) ?? 0}</div>,
    },
    {
      clave: "dias_entrega",
      label: "Entrega",
      celda: (p) => (
        <div className="tabular-nums">
          {p.dias_entrega !== null ? (
            `${p.dias_entrega} días`
          ) : (
            <span className="text-muted-foreground/50" title="Sin capturar: se usa el default">
              {diasEntregaDefault} días
            </span>
          )}
        </div>
      ),
    },
    {
      clave: "notas",
      label: "Notas",
      celda: (p) => (
        <div className="truncate text-muted-foreground" title={p.notas ?? undefined}>
          {p.notas ?? "—"}
        </div>
      ),
    },
  ];

  return (
    <TablaSimple cols={COLS} columnas={columnas} datos={proveedores} filaKey={(p) => p.id} onRowClick={onEditar} />
  );
}
