"use client";

import { useMemo, useState } from "react";
import { ClipboardPaste, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Pastilla } from "@/components/compartido/pastilla";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import {
  cambiarEstadoItem,
  cerrarRecepcion,
  descontarChecados,
  guardarRecepcion,
  importarItemsRecepcion,
  borrarItemRecepcion,
  borrarRecepcion,
  type RecepcionItemInput,
} from "@/app/(app)/inventario/bodega/actions";
import { ESTADOS_RECEPCION, obtenerEstadoRecepcion, obtenerCanal } from "@/lib/catalogos";
import { matchProductoPorSku, parsearCantidad, parsearTSV } from "@/lib/importar/tsv";
import { formatearFecha } from "@/lib/fecha";
import { cn } from "@/lib/utils";
import type { ProductoLigeroFila } from "@/app/(app)/inventario/bodega/page";
import type { EstadoRecepcionId, RecepcionConItems, RecepcionItem } from "@/lib/types";

const ENCABEZADOS = [
  "SKU",
  "UNIDADES NO PROCESADAS",
  "SKU CONSOLIDADO",
  "CANTIDAD CONSOLIDADA",
  "CATEGORIA",
  "PRODUCTO",
  "TALLA",
];

/* Recepción de mercancía: la carga abierta con sus renglones, tal como la
   plantilla del Sheet, pero con los estados como botones en vez de fórmulas. */
export function SeccionRecepcion({
  recepciones,
  productos,
}: {
  recepciones: RecepcionConItems[];
  productos: ProductoLigeroFila[];
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [seleccionadaId, setSeleccionadaId] = useState<string | null>(recepciones[0]?.id ?? null);
  const [dialogoNueva, setDialogoNueva] = useState(false);
  const [importando, setImportando] = useState(false);

  const seleccionada =
    recepciones.find((r) => r.id === seleccionadaId) ?? recepciones[0] ?? null;

  if (!recepciones.length) {
    return (
      <div className="rounded-2xl border bg-card p-10 text-center shadow-sm">
        <p className="text-[15px] font-semibold">Todavía no hay ninguna carga registrada.</p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Una carga es la mercancía que llega y se va cargando al sistema, con sus estados
          Traer → Cargado → Checado → Descontado.
        </p>
        <Button className="mt-4" onClick={() => setDialogoNueva(true)}>
          <Plus className="size-4" /> Nueva carga
        </Button>
        {dialogoNueva && <DialogoCarga onClose={() => setDialogoNueva(false)} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={seleccionada?.id} onValueChange={(v) => v && setSeleccionadaId(v)}>
          <SelectTrigger className="w-full bg-card md:w-[320px]">
            <SelectValue>
              {(v: string) => recepciones.find((r) => r.id === v)?.titulo ?? "Carga"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {recepciones.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.titulo} {r.estado === "cerrada" ? "· cerrada" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex-1" />

        <Button variant="outline" onClick={() => setImportando(true)} disabled={!seleccionada}>
          <ClipboardPaste className="size-4" /> Pegar renglones
        </Button>
        <Button onClick={() => setDialogoNueva(true)}>
          <Plus className="size-4" /> Nueva carga
        </Button>
      </div>

      {seleccionada && (
        <DetalleCarga
          carga={seleccionada}
          productos={productos}
          pending={pending}
          onCambiarEstado={(item, estado) =>
            ejecutar(() => cambiarEstadoItem(item.id, estado), {
              ok:
                estado === "descontado"
                  ? `${item.sku}: ${item.unidades_no_procesadas} al stock.`
                  : undefined,
              error: "No se pudo mover el renglón. Revisa tu conexión.",
            })
          }
          onBorrarItem={(item) =>
            ejecutar(() => borrarItemRecepcion(item.id), {
              confirmar: `¿Quitar ${item.sku} de la carga?`,
            })
          }
          onDescontarChecados={() =>
            ejecutar(() => descontarChecados(seleccionada.id), {
              confirmar:
                "Se van a sumar al stock todos los renglones checados. ¿Seguir?",
              error: "No se pudo descontar. Revisa tu conexión.",
              alExito: (r) => {
                const datos = "datos" in r ? r.datos : { descontados: 0 };
                toast.success(
                  datos.descontados === 0
                    ? "No había renglones checados."
                    : `${datos.descontados} ${datos.descontados === 1 ? "renglón descontado" : "renglones descontados"}.`,
                );
              },
            })
          }
          onCerrar={() =>
            ejecutar(() => cerrarRecepcion(seleccionada.id, seleccionada.estado === "abierta"), {
              ok: seleccionada.estado === "abierta" ? "Carga cerrada." : "Carga reabierta.",
            })
          }
          onBorrarCarga={() =>
            ejecutar(() => borrarRecepcion(seleccionada.id), {
              confirmar: `¿Borrar la carga «${seleccionada.titulo}» y todos sus renglones?`,
              ok: "Carga borrada.",
              alExito: () => setSeleccionadaId(null),
            })
          }
        />
      )}

      {dialogoNueva && <DialogoCarga onClose={() => setDialogoNueva(false)} />}
      {importando && seleccionada && (
        <DialogoImportarRenglones
          recepcionId={seleccionada.id}
          productos={productos}
          onClose={() => setImportando(false)}
        />
      )}
    </div>
  );
}

/* --- Detalle de una carga: avance por estado + tabla de renglones ---------- */
function DetalleCarga({
  carga,
  productos,
  pending,
  onCambiarEstado,
  onBorrarItem,
  onDescontarChecados,
  onCerrar,
  onBorrarCarga,
}: {
  carga: RecepcionConItems;
  productos: ProductoLigeroFila[];
  pending: boolean;
  onCambiarEstado: (item: RecepcionItem, estado: EstadoRecepcionId) => void;
  onBorrarItem: (item: RecepcionItem) => void;
  onDescontarChecados: () => void;
  onCerrar: () => void;
  onBorrarCarga: () => void;
}) {
  /* La CANTIDAD CONSOLIDADA de la hoja: suma de unidades por SKU consolidado.
     Se deriva aquí en vez de guardarse para que no pueda descuadrarse. */
  const consolidado = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const i of carga.items) {
      const clave = i.sku_consolidado || i.sku;
      mapa.set(clave, (mapa.get(clave) ?? 0) + i.unidades_no_procesadas);
    }
    return mapa;
  }, [carga.items]);

  const porEstado = ESTADOS_RECEPCION.map((e) => ({
    ...e,
    n: carga.items.filter((i) => i.estado === e.id).length,
  }));
  const canal = obtenerCanal(carga.canal);
  const nombreProducto = (i: RecepcionItem) =>
    productos.find((p) => p.id === i.producto_id)?.nombre ?? i.producto_nombre ?? "—";

  return (
    <div className="rounded-2xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-[16px] font-bold">{carga.titulo}</h2>
            {canal && <Pastilla nombre={canal.nombre} color={canal.color} />}
            {carga.estado === "cerrada" && <Pastilla nombre="Cerrada" color="#94a3b8" />}
          </div>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            {carga.items.length} {carga.items.length === 1 ? "renglón" : "renglones"} ·{" "}
            {formatearFecha(carga.created_at.slice(0, 10))}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {porEstado.map((e) => (
            <Pastilla key={e.id} nombre={`${e.nombre}: ${e.n}`} color={e.color} />
          ))}
        </div>

        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onDescontarChecados} disabled={pending}>
            Descontar checados
          </Button>
          <Button variant="outline" size="sm" onClick={onCerrar} disabled={pending}>
            {carga.estado === "abierta" ? "Cerrar carga" : "Reabrir"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onBorrarCarga} disabled={pending}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {carga.pedido_proveedor_id && (
        <p className="border-b bg-amber-500/10 px-5 py-2 text-[13px] text-amber-700 dark:text-amber-400">
          Esta carga viene de un pedido a proveedor. Si ese pedido ya se recibió «sumando stock», no
          lo descuentes aquí también: se contaría dos veces.
        </p>
      )}

      {carga.items.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">
          Sin renglones todavía. Pega la plantilla de la hoja con «Pegar renglones».
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-2.5 font-semibold">SKU</th>
                <th className="px-3 py-2.5 font-semibold">Producto</th>
                <th className="px-3 py-2.5 font-semibold">Talla</th>
                <th className="px-3 py-2.5 text-right font-semibold">Unidades</th>
                <th className="px-3 py-2.5 text-right font-semibold">Consolidado</th>
                <th className="px-3 py-2.5 font-semibold">Estado</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {carga.items.map((i) => {
                const estado = obtenerEstadoRecepcion(i.estado);
                return (
                  <tr key={i.id} className="border-t">
                    <td className="px-5 py-2 font-mono text-[12.5px]">
                      {i.sku}
                      {!i.producto_id && (
                        <span className="ml-1.5 text-[11px] text-amber-600">sin ficha</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{nombreProducto(i)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{i.talla ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{i.unidades_no_procesadas}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {consolidado.get(i.sku_consolidado || i.sku) ?? 0}
                    </td>
                    <td className="px-3 py-2">
                      {i.estado === "descontado" ? (
                        <Pastilla nombre={estado?.nombre ?? i.estado} color={estado?.color ?? "#94a3b8"} />
                      ) : (
                        <Select
                          value={i.estado}
                          disabled={pending}
                          onValueChange={(v) =>
                            v && v !== i.estado && onCambiarEstado(i, v as EstadoRecepcionId)
                          }
                        >
                          <SelectTrigger className="h-8 w-[140px]">
                            <SelectValue>
                              {(v: string) => obtenerEstadoRecepcion(v)?.nombre ?? "Estado"}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {ESTADOS_RECEPCION.map((e) => (
                              <SelectItem key={e.id} value={e.id}>
                                {e.nombre}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => onBorrarItem(i)}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label="Quitar renglón"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* --- Alta de una carga ---------------------------------------------------- */
function DialogoCarga({ onClose }: { onClose: () => void }) {
  const { pending, ejecutar } = useAccionServidor();
  const [titulo, setTitulo] = useState("");
  const [canal, setCanal] = useState<"tienda_nube" | "mercado_libre">("tienda_nube");
  const [notas, setNotas] = useState("");

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nueva carga</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="carga-titulo">Nombre</Label>
            <Input
              id="carga-titulo"
              autoFocus
              placeholder="Carga 04/08 playeras"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Plantilla</Label>
            <Select value={canal} onValueChange={(v) => v && setCanal(v as typeof canal)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string) => (v === "mercado_libre" ? "Mercado Libre" : "Tienda Nube")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tienda_nube">Tienda Nube</SelectItem>
                <SelectItem value="mercado_libre">Mercado Libre</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="carga-notas">Notas</Label>
            <Textarea
              id="carga-notas"
              rows={2}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              ejecutar(
                () => guardarRecepcion(null, { titulo, canal, pedido_proveedor_id: null, notas }),
                { ok: "Carga creada.", error: "No se pudo crear. Revisa tu conexión.", alExito: onClose },
              )
            }
          >
            {pending ? "Guardando…" : "Crear carga"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* Renglón pegado, con el diagnóstico del emparejamiento para pintarlo. */
type FilaRecepcionPreview = {
  input: RecepcionItemInput;
  tipo: "exacto" | "parcial" | "ambiguo" | "ninguno";
};

/* --- Pegar la plantilla de la hoja ---------------------------------------- */
function DialogoImportarRenglones({
  recepcionId,
  productos,
  onClose,
}: {
  recepcionId: string;
  productos: ProductoLigeroFila[];
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [texto, setTexto] = useState("");

  const filas = useMemo<FilaRecepcionPreview[]>(() => {
    return parsearTSV(texto, ENCABEZADOS)
      .map((celdas): FilaRecepcionPreview | null => {
        const [
          sku = "",
          unidades = "",
          consolidado = "",
          ,
          categoria = "",
          producto = "",
          talla = "",
        ] = celdas;
        if (!sku.trim()) return null;
        const match = matchProductoPorSku(sku, productos);
        const input: RecepcionItemInput = {
          sku: sku.trim(),
          producto_id: match.tipo === "exacto" ? (match.producto?.id ?? null) : null,
          unidades_no_procesadas: parsearCantidad(unidades) ?? 0,
          sku_consolidado: consolidado.trim() || null,
          categoria: categoria.trim() || null,
          producto_nombre: producto.trim() || match.producto?.nombre || null,
          talla: talla.trim() || null,
        };
        return { input, tipo: match.tipo };
      })
      .filter((f): f is FilaRecepcionPreview => f !== null);
  }, [texto, productos]);

  const sinFicha = filas.filter((f) => f.tipo !== "exacto").length;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Pegar renglones de la carga</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Copia la plantilla de la hoja con sus columnas:{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              SKU · UNIDADES NO PROCESADAS · SKU CONSOLIDADO · CANTIDAD CONSOLIDADA · CATEGORIA ·
              PRODUCTO · TALLA
            </code>
            . La cantidad consolidada se recalcula sola, no hace falta que cuadre.
          </p>

          <Textarea
            rows={7}
            autoFocus
            className="font-mono text-[12.5px]"
            placeholder={"PLY001G\t20\tPLY001\t60\tRopa\tPlayera Olimpo\tG"}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />

          {sinFicha > 0 && (
            <p className="text-[13px] text-amber-600">
              {sinFicha} {sinFicha === 1 ? "renglón no coincide" : "renglones no coinciden"} con
              ningún SKU del catálogo: se registran igual, pero al descontarlos no se moverá stock
              (no hay ficha a la que sumarle).
            </p>
          )}

          {filas.length > 0 && (
            <div className="max-h-[320px] overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-semibold">SKU</th>
                    <th className="px-3 py-2 font-semibold">Producto</th>
                    <th className="px-3 py-2 font-semibold">Talla</th>
                    <th className="px-3 py-2 text-right font-semibold">Unidades</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f, i) => (
                    <tr key={i} className="border-t">
                      <td className={cn("px-3 py-1.5 font-mono text-[12.5px]", f.tipo !== "exacto" && "text-amber-600")}>
                        {f.input.sku}
                      </td>
                      <td className="px-3 py-1.5">{f.input.producto_nombre ?? "—"}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{f.input.talla ?? "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {f.input.unidades_no_procesadas}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button
            disabled={pending || !filas.length}
            onClick={() =>
              ejecutar(() => importarItemsRecepcion(recepcionId, filas.map((f) => f.input)), {
                error: "No se pudo importar. Revisa tu conexión.",
                alExito: (r) => {
                  const datos = "datos" in r ? r.datos : { creados: 0 };
                  toast.success(`${datos.creados} renglones agregados a la carga.`);
                  onClose();
                },
              })
            }
          >
            {pending ? "Importando…" : `Agregar ${filas.length || ""} renglones`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
