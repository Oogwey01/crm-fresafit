"use client";

import { useState, useTransition } from "react";
import { Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { TIPOS_PRODUCTO, obtenerTipoProducto } from "@/lib/catalogos";
import { formatearMXN } from "@/lib/moneda";
import { ajustarStock } from "@/app/(app)/inventario/actions";
import type { ProductConProveedor } from "@/lib/types";
import { TablaSimple, filaSimpleClases } from "@/components/compartido/tabla-simple";
import { cn } from "@/lib/utils";

const COLS = "grid-cols-[minmax(180px,1fr)_120px_140px_100px_100px_150px]";

function PastillaTipo({ tipo }: { tipo: string }) {
  const t = obtenerTipoProducto(tipo);
  if (!t) return null;
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold text-white"
      style={{ backgroundColor: t.color }}
    >
      {t.nombre}
    </span>
  );
}

export function TablaProductos({
  productos,
  onEditar,
}: {
  productos: ProductConProveedor[];
  onEditar: (p: ProductConProveedor) => void;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("todos");
  const [, startTransition] = useTransition();

  function cambiarStock(p: ProductConProveedor, delta: number) {
    const nuevo = p.stock + delta;
    if (nuevo < 0) return;
    startTransition(async () => {
      try {
        const r = await ajustarStock(p.id, nuevo);
        if ("error" in r) toast.error(r.error);
      } catch {
        toast.error("No se pudo ajustar el stock. Revisa tu conexión.");
      }
    });
  }

  const q = busqueda.trim().toLowerCase();
  const visibles = productos.filter(
    (p) =>
      (filtroTipo === "todos" || p.tipo === filtroTipo) &&
      (!q ||
        p.nombre.toLowerCase().includes(q) ||
        (p.variante ?? "").toLowerCase().includes(q) ||
        (p.proveedor?.nombre ?? "").toLowerCase().includes(q)),
  );

  return (
    <div>
      {/* Filtros: búsqueda + tipo */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          placeholder="Buscar producto, variante o proveedor…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="w-64"
        />
        <Select value={filtroTipo} onValueChange={(v) => setFiltroTipo(v ?? "todos")}>
          <SelectTrigger className="w-[170px]">
            <SelectValue>
              {(v: string) =>
                v === "todos" ? "Todos los tipos" : (obtenerTipoProducto(v)?.nombre ?? "Tipo")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los tipos</SelectItem>
            {TIPOS_PRODUCTO.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {visibles.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">
          {productos.length === 0
            ? "Aún no hay productos. Da de alta el primero con «+ Nuevo producto»."
            : "Ningún producto coincide con la búsqueda."}
        </p>
      ) : (
        <TablaSimple
          cols={COLS}
          encabezados={["Producto", "Tipo", "Proveedor", "Costo", "Precio", "Stock"]}
          minW="min-w-[820px]"
        >
          {visibles.map((p) => {
            const bajo = p.activo && p.stock <= p.stock_minimo;
            return (
              <div key={p.id} className={filaSimpleClases(COLS, !p.activo ? "opacity-50" : undefined)}>
                {/* Producto */}
                <button
                  type="button"
                  onClick={() => onEditar(p)}
                  className="truncate text-left font-medium hover:underline"
                  title={`${p.nombre}${p.variante ? ` — ${p.variante}` : ""}`}
                >
                  {p.nombre}
                  {p.variante && <span className="ml-1.5 text-muted-foreground">· {p.variante}</span>}
                  {!p.activo && <span className="ml-1.5 text-xs italic text-muted-foreground">(inactivo)</span>}
                </button>

                <div>
                  <PastillaTipo tipo={p.tipo} />
                </div>

                <div className="truncate">
                  {p.proveedor?.nombre ?? <span className="text-muted-foreground/50">—</span>}
                </div>

                <div>{formatearMXN(p.costo)}</div>
                <div>{formatearMXN(p.precio)}</div>

                {/* Stock con ajuste rápido */}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => cambiarStock(p, -1)}
                    disabled={p.stock === 0}
                    className="flex size-6 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent disabled:opacity-40"
                    aria-label={`Restar 1 al stock de ${p.nombre}`}
                  >
                    <Minus className="size-3.5" />
                  </button>
                  <span
                    className={cn(
                      "min-w-8 text-center font-semibold tabular-nums",
                      bajo && "text-red-600",
                    )}
                  >
                    {p.stock}
                  </span>
                  <button
                    type="button"
                    onClick={() => cambiarStock(p, 1)}
                    className="flex size-6 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent"
                    aria-label={`Sumar 1 al stock de ${p.nombre}`}
                  >
                    <Plus className="size-3.5" />
                  </button>
                  {bajo && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-600 dark:bg-red-950 dark:text-red-300">
                      Bajo
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </TablaSimple>
      )}
    </div>
  );
}
