"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { hoyISO, formatearFecha } from "@/lib/fecha";
import {
  registrarConteo,
  borrarConteo,
  type ConteoInput,
} from "@/app/(app)/inventario/actions";
import type { ConteoConProducto, ProductConProveedor, Profile } from "@/lib/types";
import { DatePicker } from "@/components/compartido/date-picker";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { cn } from "@/lib/utils";

const PRODUCTO_LIBRE = "libre";
const NADIE = "none";

/* Registro de conteos físicos de inventario: quién contó qué y quién lo
   corroboró. Compara la cantidad contada contra el stock del CRM para resaltar
   los descuadres del inventario real. */
export function ConteoFisico({
  conteos,
  productos,
  equipo,
}: {
  conteos: ConteoConProducto[];
  productos: ProductConProveedor[];
  equipo: Profile[];
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [productoId, setProductoId] = useState<string>(PRODUCTO_LIBRE);
  const [descripcion, setDescripcion] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [contadoPor, setContadoPor] = useState("");
  const [corroboradoPor, setCorroboradoPor] = useState("");
  const [nota, setNota] = useState("");
  const [fecha, setFecha] = useState(hoyISO());

  function limpiar() {
    setProductoId(PRODUCTO_LIBRE);
    setDescripcion("");
    setCantidad("");
    setContadoPor("");
    setCorroboradoPor("");
    setNota("");
  }

  function guardar() {
    const cant = Math.trunc(Number(cantidad));
    if (!Number.isFinite(cant) || cant < 0) {
      toast.error("Escribe la cantidad contada.");
      return;
    }
    const input: ConteoInput = {
      producto_id: productoId === PRODUCTO_LIBRE ? null : productoId,
      descripcion,
      cantidad: cant,
      contado_por: contadoPor,
      corroborado_por: corroboradoPor,
      nota,
      fecha,
    };
    ejecutar(() => registrarConteo(input), {
      ok: "Conteo registrado.",
      error: "No se pudo guardar el conteo. Revisa tu conexión.",
      alExito: limpiar,
    });
  }

  function quitar(id: string) {
    ejecutar(() => borrarConteo(id), {
      ok: "Conteo borrado.",
      error: "No se pudo borrar el conteo.",
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div>
        <h3 className="text-sm font-bold">Conteo físico</h3>
        <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
          Para quienes hacen el inventario: apunta lo que contaste, quién lo contó y quién lo
          corroboró. Se compara contra el stock del CRM para ver dónde hay descuadre.
        </p>
      </div>

      {/* Alta de conteo */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="col-span-2">
          <Select value={productoId} onValueChange={(v) => setProductoId(v ?? PRODUCTO_LIBRE)}>
            <SelectTrigger className="w-full">
              <SelectValue>
                {(v: string) => {
                  if (v === PRODUCTO_LIBRE) return "Otro (describir)";
                  const p = productos.find((x) => x.id === v);
                  return p ? `${p.nombre}${p.variante ? ` · ${p.variante}` : ""}` : "Producto";
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={PRODUCTO_LIBRE}>Otro (describir)</SelectItem>
              {productos
                .filter((p) => p.activo)
                .map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nombre}
                    {p.variante ? ` · ${p.variante}` : ""}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        {productoId === PRODUCTO_LIBRE && (
          <Input
            className="col-span-2"
            placeholder="Qué se contó"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
          />
        )}
        <Input
          type="number"
          min="0"
          step="1"
          placeholder="Cantidad"
          value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
        />
        <DatePicker value={fecha} onChange={setFecha} />
        <Select value={contadoPor || NADIE} onValueChange={(v) => setContadoPor(v === NADIE ? "" : (v ?? ""))}>
          <SelectTrigger className="w-full">
            <SelectValue>{(v: string) => (v === NADIE ? "Contó…" : v)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NADIE}>Contó… (elegir)</SelectItem>
            {equipo.map((p) => (
              <SelectItem key={p.id} value={p.nombre}>
                {p.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={corroboradoPor || NADIE} onValueChange={(v) => setCorroboradoPor(v === NADIE ? "" : (v ?? ""))}>
          <SelectTrigger className="w-full">
            <SelectValue>{(v: string) => (v === NADIE ? "Corroboró…" : v)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NADIE}>Corroboró… (elegir)</SelectItem>
            {equipo.map((p) => (
              <SelectItem key={p.id} value={p.nombre}>
                {p.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="col-span-2 sm:col-span-3"
          placeholder="Nota (opcional)"
          value={nota}
          onChange={(e) => setNota(e.target.value)}
        />
        <Button variant="outline" onClick={guardar} disabled={pending} className="col-span-2 sm:col-span-1">
          Registrar conteo
        </Button>
      </div>

      {/* Lista de conteos recientes */}
      {conteos.length > 0 && (
        <div className="flex flex-col gap-1">
          {conteos.map((c) => {
            const stockCRM = c.producto?.stock ?? null;
            const difiere = stockCRM !== null && stockCRM !== c.cantidad;
            const nombre = c.producto
              ? `${c.producto.nombre}${c.producto.variante ? ` · ${c.producto.variante}` : ""}`
              : (c.descripcion ?? "—");
            return (
              <div
                key={c.id}
                className={cn(
                  "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2.5 py-1.5 text-sm",
                  difiere ? "bg-red-50 dark:bg-red-950/40" : "bg-muted/50",
                )}
              >
                <span className="min-w-0 flex-1 truncate font-medium" title={nombre}>
                  {nombre}
                </span>
                <span className="tabular-nums">
                  Contado: <b>{c.cantidad}</b>
                  {stockCRM !== null && (
                    <span className={cn("ml-1.5", difiere ? "font-semibold text-red-600" : "text-muted-foreground")}>
                      · CRM: {stockCRM}
                      {difiere && ` (${c.cantidad - stockCRM > 0 ? "+" : ""}${c.cantidad - stockCRM})`}
                    </span>
                  )}
                </span>
                <span className="text-[12px] text-muted-foreground">
                  {c.contado_por ?? "?"}
                  {c.corroborado_por ? ` · corr. ${c.corroborado_por}` : ""} · {formatearFecha(c.fecha)}
                </span>
                <button
                  type="button"
                  onClick={() => quitar(c.id)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Borrar conteo"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
