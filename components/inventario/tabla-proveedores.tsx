"use client";

import type { ProductConProveedor, Supplier } from "@/lib/types";
import { TablaSimple, filaSimpleClases } from "@/components/compartido/tabla-simple";

const COLS = "grid-cols-[minmax(160px,1fr)_140px_200px_100px_minmax(140px,1fr)]";

export function TablaProveedores({
  proveedores,
  productos,
  onEditar,
}: {
  proveedores: Supplier[];
  productos: ProductConProveedor[];
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

  return (
    <TablaSimple
      cols={COLS}
      encabezados={["Proveedor", "Teléfono", "Correo", "Productos", "Notas"]}
    >
      {proveedores.map((p) => (
        <div key={p.id} className={filaSimpleClases(COLS)}>
          <button
            type="button"
            onClick={() => onEditar(p)}
            className="truncate text-left font-medium hover:underline"
            title={p.nombre}
          >
            {p.nombre}
          </button>
          <div className="truncate">
            {p.telefono ? (
              <a href={`tel:${p.telefono}`} className="hover:underline">
                {p.telefono}
              </a>
            ) : (
              <span className="text-muted-foreground/50">—</span>
            )}
          </div>
          <div className="truncate">
            {p.correo ? (
              <a href={`mailto:${p.correo}`} className="hover:underline">
                {p.correo}
              </a>
            ) : (
              <span className="text-muted-foreground/50">—</span>
            )}
          </div>
          <div className="tabular-nums">{productosPor.get(p.id) ?? 0}</div>
          <div className="truncate text-muted-foreground" title={p.notas ?? undefined}>
            {p.notas ?? "—"}
          </div>
        </div>
      ))}
    </TablaSimple>
  );
}
