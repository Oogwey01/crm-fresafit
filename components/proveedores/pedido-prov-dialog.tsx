"use client";

import { useRef, useState } from "react";
import { Paperclip, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DialogoFormulario,
  Hero,
  Propiedades,
  SeccionFormulario,
} from "@/components/compartido/dialogo-formulario";
import { Campo } from "@/components/compartido/campo";
import { DescripcionHero } from "@/components/compartido/campo-hero";
import {
  PastillaFecha,
  PastillaOpcion,
} from "@/components/compartido/pastillas-campo";
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
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { useDetalleRemoto } from "@/components/compartido/use-detalle-remoto";
import { aNumero } from "@/lib/validacion";
import { ESTADOS_PEDIDO_PROVEEDOR } from "@/lib/catalogos";
import { hoyISO, formatearFecha, sumarDias } from "@/lib/fecha";
import { formatearMXN } from "@/lib/moneda";
import {
  guardarPedidoProv,
  borrarPedidoProv,
  cargarDetallePedido,
  registrarPagoPedido,
  borrarPagoPedido,
  urlComprobantePedido,
  agregarIncidenciaPedido,
  resolverIncidenciaPedido,
  borrarIncidenciaPedido,
  type PedidoProvInput,
} from "@/app/(app)/proveedores/actions";
import type {
  EstadoPedidoProvId,
  PedidoProvDetalle,
  Supplier,
  SupplierOrderConDetalle,
} from "@/lib/types";
import { DatePicker } from "@/components/compartido/date-picker";
import type { ProductoProveedor } from "@/lib/proveedores/tipos";

const PRODUCTO_LIBRE = "libre";

/* Renglón editable del pedido (estado local del formulario). */
type Renglon = {
  producto_id: string | null; // null = descripción libre
  descripcion: string;
  cantidad: string;
  costo_unitario: string;
};

function renglonVacio(): Renglon {
  return { producto_id: null, descripcion: "", cantidad: "1", costo_unitario: "" };
}

/* Renglones con los que arranca un pedido nuevo. Los manda «Qué pedir» (solo
   producto y cantidad) o el pegado desde Excel, que además trae el costo de la
   hoja y puede no reconocer el SKU (producto_id null → descripción libre). */
export type ItemInicialPedido = {
  producto_id: string | null;
  descripcion?: string;
  cantidad: number;
  costo_unitario?: number | null;
};

/* Alta y edición de un pedido a proveedor, con sus renglones. */
export function PedidoProvDialog({
  pedido,
  proveedores,
  productos,
  gestor,
  diasEntregaDefault,
  itemsIniciales,
  notasIniciales,
  onClose,
}: {
  pedido: SupplierOrderConDetalle | null; // null = alta
  proveedores: Supplier[];
  productos: ProductoProveedor[];
  gestor: boolean;
  /* Días de entrega global (para autocalcular la ETA si el proveedor no tiene el suyo). */
  diasEntregaDefault: number;
  /* Solo en el alta: precarga renglones (sugerencia de reabastecimiento). */
  itemsIniciales?: ItemInicialPedido[];
  /* Notas con las que abre un pedido nuevo (p. ej. el folio y la moneda de la
     factura que se leyó). */
  notasIniciales?: string;
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  /* Al pedir desde «Qué pedir» ya se sabe quién surte ese producto. */
  const proveedorSugerido =
    itemsIniciales?.map((i) => productos.find((p) => p.id === i.producto_id)?.proveedor_id).find(Boolean) ?? "";
  const [proveedorId, setProveedorId] = useState(pedido?.proveedor_id ?? proveedorSugerido);
  const [fechaPedido, setFechaPedido] = useState(pedido?.fecha_pedido ?? hoyISO());
  /* ETA: se autocalcula (fecha del pedido + días de entrega del proveedor). Si el
     usuario la fija a mano, su valor manda (etaOverride ≠ null). Se deriva en
     render, sin efecto, para no disparar renders en cascada. */
  const [etaOverride, setEtaOverride] = useState<string | null>(pedido?.fecha_estimada ?? null);
  const provElegido = proveedores.find((p) => p.id === proveedorId);
  const etaAuto = fechaPedido
    ? sumarDias(fechaPedido, provElegido?.dias_entrega ?? diasEntregaDefault)
    : "";
  const fechaEstimada = etaOverride ?? etaAuto;
  const [estado, setEstado] = useState<EstadoPedidoProvId>(pedido?.estado ?? "pedido");
  const [notas, setNotas] = useState(pedido?.notas ?? notasIniciales ?? "");
  const [renglones, setRenglones] = useState<Renglon[]>(() => {
    if (pedido && pedido.items.length > 0) {
      return pedido.items.map((i) => ({
        producto_id: i.producto_id,
        descripcion: i.descripcion ?? "",
        cantidad: String(i.cantidad),
        costo_unitario: i.costo_unitario?.toString() ?? "",
      }));
    }
    if (itemsIniciales?.length) {
      return itemsIniciales.map((i) => ({
        producto_id: i.producto_id,
        descripcion: i.descripcion ?? "",
        cantidad: String(i.cantidad),
        /* El costo de la hoja manda; si no viene, el del catálogo. */
        costo_unitario:
          i.costo_unitario != null
            ? String(i.costo_unitario)
            : (productos.find((p) => p.id === i.producto_id)?.costo?.toString() ?? ""),
      }));
    }
    return [renglonVacio()];
  });
  /* Total: se sugiere la suma de renglones, pero se puede escribir a mano. */
  const [totalManual, setTotalManual] = useState(pedido?.costo_total?.toString() ?? "");

  /* Rastreo del envío (una guía principal). */
  const [paqueteria, setPaqueteria] = useState(pedido?.paqueteria ?? "");
  const [numGuia, setNumGuia] = useState(pedido?.num_guia ?? "");
  const [urlRastreo, setUrlRastreo] = useState(pedido?.url_rastreo ?? "");
  /* Si el pedido YA traía datos de rastreo, la sección nace abierta (se captura
     al montar: que teclear una guía no ande abriendo secciones solo). */
  const [rastreoConDatos] = useState(
    Boolean(pedido && (pedido.paqueteria || pedido.num_guia || pedido.url_rastreo)),
  );

  /* Pagos + incidencias: solo se gestionan sobre un pedido ya guardado (necesitan
     su id). Se cargan al abrir en modo edición. */
  const { datos: detalle, recargar } = useDetalleRemoto<PedidoProvDetalle | null>(
    () => (pedido ? cargarDetallePedido(pedido.id) : Promise.resolve(null)),
    pedido?.id ?? "",
  );

  const [pagoMonto, setPagoMonto] = useState("");
  const [pagoFecha, setPagoFecha] = useState(hoyISO());
  const [pagoNota, setPagoNota] = useState("");
  const pagoFileRef = useRef<HTMLInputElement>(null);
  const [incidenciaTexto, setIncidenciaTexto] = useState("");

  const totalPagado = (detalle?.pagos ?? []).reduce((a, p) => a + Number(p.monto), 0);

  function agregarPago() {
    if (!pedido) return;
    const monto = Number(pagoMonto);
    if (!Number.isFinite(monto) || monto <= 0) {
      toast.error("Escribe el monto del pago.");
      return;
    }
    const fd = new FormData();
    fd.append("monto", String(monto));
    fd.append("fecha", pagoFecha);
    fd.append("nota", pagoNota);
    const file = pagoFileRef.current?.files?.[0];
    if (file) fd.append("file", file);
    ejecutar(() => registrarPagoPedido(pedido.id, fd), { ok: "Pago registrado.", alExito: recargar });
    setPagoMonto("");
    setPagoNota("");
    if (pagoFileRef.current) pagoFileRef.current.value = "";
  }

  async function verComprobante(path: string) {
    const r = await urlComprobantePedido(path);
    if ("error" in r) return toast.error(r.error);
    window.open(r.url, "_blank");
  }

  function agregarIncidencia() {
    if (!pedido || !incidenciaTexto.trim()) return;
    ejecutar(() => agregarIncidenciaPedido(pedido.id, incidenciaTexto), {
      ok: "Incidencia registrada.",
      alExito: recargar,
    });
    setIncidenciaTexto("");
  }

  const sumaRenglones = renglones.reduce((acc, r) => {
    const cant = Number(r.cantidad) || 0;
    const costo = Number(r.costo_unitario) || 0;
    return acc + cant * costo;
  }, 0);
  const total = totalManual.trim() !== "" ? aNumero(totalManual) : sumaRenglones > 0 ? sumaRenglones : null;

  function editarRenglon(idx: number, cambio: Partial<Renglon>) {
    setRenglones((prev) => prev.map((r, i) => (i === idx ? { ...r, ...cambio } : r)));
  }

  function guardar() {
    const input: PedidoProvInput = {
      proveedor_id: proveedorId,
      fecha_pedido: fechaPedido,
      fecha_estimada: fechaEstimada || null,
      estado,
      costo_total: total,
      paqueteria,
      num_guia: numGuia,
      url_rastreo: urlRastreo,
      notas,
      items: renglones.map((r) => ({
        producto_id: r.producto_id,
        descripcion: r.descripcion,
        cantidad: Math.trunc(Number(r.cantidad) || 0),
        costo_unitario: aNumero(r.costo_unitario),
      })),
    };
    ejecutar(() => guardarPedidoProv(pedido?.id ?? null, input), {
      ok: pedido ? "Pedido actualizado." : "Pedido registrado.",
      error: "No se pudo guardar. Revisa tu conexión.",
      alExito: onClose,
    });
  }

  function borrar() {
    if (!pedido) return;
    ejecutar(() => borrarPedidoProv(pedido.id), {
      confirmar: "¿Borrar este pedido a proveedor? Esto no se puede deshacer.",
      ok: "Pedido borrado.",
      error: "No se pudo borrar. Revisa tu conexión.",
      alExito: onClose,
    });
  }

  return (
    <DialogoFormulario
      titulo={pedido ? "Editar pedido a proveedor" : "Nuevo pedido a proveedor"}
      onCerrar={onClose}
      onGuardar={guardar}
      etiquetaGuardar={pedido ? "Guardar cambios" : "Registrar pedido"}
      pending={pending}
      onBorrar={pedido && gestor ? borrar : undefined}
      anchoEscritorio="md:max-w-2xl"
    >
      <Hero pasoTitulo="¿A quién se le pidió?">
        <Campo etiqueta="Proveedor" className="w-full">
          <Select value={proveedorId || undefined} onValueChange={(v) => v && setProveedorId(v)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Elegir…">
                {(v: string) => proveedores.find((p) => p.id === v)?.nombre ?? "Elegir…"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {proveedores.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
        <DescripcionHero
          id="ped-notas"
          etiqueta="Notas"
          placeholder="Condiciones, aduana… (opcional)"
          valor={notas}
          onCambio={setNotas}
        />
      </Hero>

      <Propiedades pasoTitulo="Fechas y estado">
        <PastillaFecha
          etiqueta="Fecha del pedido"
          etiquetaVacia="Fecha del pedido"
          valor={fechaPedido}
          onCambio={setFechaPedido}
        />
        {/* La ETA respeta etaOverride: mientras nadie la toque sigue a la fecha
            del pedido + días de entrega del proveedor. */}
        <PastillaFecha
          etiqueta="Llega (aprox.)"
          etiquetaVacia="Llega (aprox.)"
          valor={fechaEstimada}
          onCambio={setEtaOverride}
          limpiable
          ayuda="Se propone con los días de entrega del proveedor; si la fijas a mano, tu fecha manda."
        />
        <PastillaOpcion
          etiqueta="Estado"
          opciones={ESTADOS_PEDIDO_PROVEEDOR}
          valor={estado}
          onCambio={setEstado}
        />
      </Propiedades>

      {/* Renglones del pedido: sin renglones no hay pedido, así que la sección
          nace abierta. */}
      <SeccionFormulario
        titulo="Renglones"
        pasoTitulo="¿Qué se pidió?"
        contador={renglones.length}
        abiertaPorDefecto
      >
        <div className="flex flex-col gap-2">
          {renglones.map((r, idx) => (
            <div key={idx} className="flex flex-col gap-2 rounded-lg border bg-muted/20 p-2">
              {/* Producto del catálogo o descripción libre (renglón completo
                  para que el nombre no se corte) */}
              <div className="flex items-center gap-2">
                <Select
                  value={r.producto_id ?? PRODUCTO_LIBRE}
                  onValueChange={(v) =>
                    editarRenglon(idx, { producto_id: !v || v === PRODUCTO_LIBRE ? null : v })
                  }
                >
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
                {r.producto_id === null && (
                  <Input
                    placeholder="Descripción"
                    value={r.descripcion}
                    onChange={(e) => editarRenglon(idx, { descripcion: e.target.value })}
                  />
                )}
              </div>
              {/* Cantidad · costo · quitar: fila propia en móvil, inline en escritorio */}
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="1"
                  step="1"
                  aria-label="Cantidad"
                  title="Cantidad"
                  className="w-20 shrink-0"
                  value={r.cantidad}
                  onChange={(e) => editarRenglon(idx, { cantidad: e.target.value })}
                />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="$ c/u"
                  aria-label="Costo unitario"
                  title="Costo unitario"
                  className="w-28 shrink-0"
                  value={r.costo_unitario}
                  onChange={(e) => editarRenglon(idx, { costo_unitario: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => setRenglones((prev) => prev.filter((_, i) => i !== idx))}
                  disabled={renglones.length === 1}
                  className="flex size-9 shrink-0 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent disabled:opacity-40 md:size-8"
                  aria-label="Quitar renglón"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>
          ))}
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRenglones((prev) => [...prev, renglonVacio()])}
            >
              + Agregar renglón
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5 sm:max-w-56">
          <Label htmlFor="ped-total">
            Costo total{" "}
            {sumaRenglones > 0 && totalManual.trim() === "" && (
              <span className="font-normal text-muted-foreground">
                (sugerido: {formatearMXN(sumaRenglones)})
              </span>
            )}
          </Label>
          <Input
            id="ped-total"
            type="number"
            min="0"
            step="0.01"
            placeholder={sumaRenglones > 0 ? sumaRenglones.toFixed(2) : "0.00"}
            value={totalManual}
            onChange={(e) => setTotalManual(e.target.value)}
          />
        </div>
      </SeccionFormulario>

      {/* Rastreo del envío */}
      <SeccionFormulario
        titulo="Rastreo del envío"
        pasoTitulo="Rastreo del envío"
        pasoAyuda="Opcional: la paquetería y la guía cuando ya viene en camino."
        abiertaPorDefecto={rastreoConDatos}
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Input
            placeholder="Paquetería"
            value={paqueteria}
            onChange={(e) => setPaqueteria(e.target.value)}
          />
          <Input
            placeholder="Nº de guía"
            value={numGuia}
            onChange={(e) => setNumGuia(e.target.value)}
          />
          <Input
            placeholder="Link de rastreo (https://…)"
            value={urlRastreo}
            onChange={(e) => setUrlRastreo(e.target.value)}
            className="col-span-2 sm:col-span-1"
          />
        </div>
      </SeccionFormulario>

      {/* Pagos e incidencias: solo sobre un pedido ya guardado. */}
      {pedido && (
        <SeccionFormulario
          titulo="Pagos"
          pasoTitulo="Pagos"
          contador={detalle ? detalle.pagos.length : null}
          abiertaPorDefecto={(detalle?.pagos.length ?? 0) > 0}
        >
          <p className="text-[12.5px] text-muted-foreground">
            Pagado <b className="text-foreground">{formatearMXN(totalPagado)}</b>
            {total != null && total > 0 && ` de ${formatearMXN(total)}`}
          </p>
          <div className="flex flex-col gap-1">
            {(detalle?.pagos ?? []).map((p) => (
              <div key={p.id} className="flex items-center gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-sm">
                <span className="tabular-nums font-semibold">{formatearMXN(Number(p.monto))}</span>
                <span className="text-muted-foreground">{formatearFecha(p.fecha)}</span>
                {p.nota && <span className="truncate text-muted-foreground">· {p.nota}</span>}
                {p.comprobante_path && (
                  <button
                    type="button"
                    onClick={() => verComprobante(p.comprobante_path!)}
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                    title={p.comprobante_nombre ?? "Ver comprobante"}
                  >
                    <Paperclip className="size-3.5" /> comprobante
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    ejecutar(() => borrarPagoPedido(p.id, p.comprobante_path), {
                      ok: "Pago borrado.",
                      alExito: recargar,
                    })
                  }
                  className="ml-auto text-muted-foreground hover:text-destructive"
                  aria-label="Borrar pago"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
            {detalle && detalle.pagos.length === 0 && (
              <p className="text-[13px] text-muted-foreground">Sin pagos registrados.</p>
            )}
          </div>
          {/* Alta de pago */}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="$ monto"
              className="w-28"
              value={pagoMonto}
              onChange={(e) => setPagoMonto(e.target.value)}
            />
            <div className="w-40">
              <DatePicker value={pagoFecha} onChange={setPagoFecha} />
            </div>
            <Input
              placeholder="Nota (opcional)"
              className="min-w-[120px] flex-1"
              value={pagoNota}
              onChange={(e) => setPagoNota(e.target.value)}
            />
            <input ref={pagoFileRef} type="file" className="hidden" />
            <Button variant="outline" size="sm" onClick={() => pagoFileRef.current?.click()}>
              <Paperclip className="size-3.5" /> Comprobante
            </Button>
            <Button variant="outline" size="sm" onClick={agregarPago} disabled={pending}>
              Registrar pago
            </Button>
          </div>
        </SeccionFormulario>
      )}

      {pedido && (
        <SeccionFormulario
          titulo="Incidencias"
          pasoTitulo="Incidencias"
          contador={detalle ? detalle.incidencias.length : null}
          abiertaPorDefecto={(detalle?.incidencias.length ?? 0) > 0}
        >
          <div className="flex flex-col gap-1">
            {(detalle?.incidencias ?? []).map((inc) => (
              <div key={inc.id} className="flex items-center gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={inc.resuelto}
                  onChange={(e) =>
                    ejecutar(() => resolverIncidenciaPedido(inc.id, e.target.checked), {
                      ok: e.target.checked ? "Incidencia resuelta." : "Incidencia reabierta.",
                      alExito: recargar,
                    })
                  }
                  title="Marcar resuelta"
                  className="size-4 accent-primary"
                />
                <span className={cn("min-w-0 flex-1 truncate", inc.resuelto && "text-muted-foreground line-through")} title={inc.texto}>
                  {inc.texto}
                </span>
                <span className="shrink-0 text-[12px] text-muted-foreground">{formatearFecha(inc.fecha)}</span>
                <button
                  type="button"
                  onClick={() =>
                    ejecutar(() => borrarIncidenciaPedido(inc.id), {
                      ok: "Incidencia borrada.",
                      alExito: recargar,
                    })
                  }
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Borrar incidencia"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
            {detalle && detalle.incidencias.length === 0 && (
              <p className="text-[13px] text-muted-foreground">Sin incidencias.</p>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Describe una incidencia…"
              value={incidenciaTexto}
              onChange={(e) => setIncidenciaTexto(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && agregarIncidencia()}
            />
            <Button variant="outline" size="sm" onClick={agregarIncidencia} disabled={pending}>
              Agregar
            </Button>
          </div>
        </SeccionFormulario>
      )}
    </DialogoFormulario>
  );
}
