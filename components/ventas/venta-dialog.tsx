"use client";

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
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
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/compartido/date-picker";
import { Label } from "@/components/ui/label";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { PieDialogoCRUD } from "@/components/compartido/pie-dialogo-crud";
import { aNumero } from "@/lib/validacion";
import { CANALES } from "@/lib/catalogos";
import { hoyISO } from "@/lib/fecha";
import { formatearMXN } from "@/lib/moneda";
import {
  registrarVenta,
  editarVenta,
  borrarVenta,
  type VentaInput,
} from "@/app/(app)/metricas/actions";
import { crearClienteRapido } from "@/app/(app)/clientes/actions";
import type { CanalId, Customer, Product, SaleConProducto } from "@/lib/types";

function etiquetaProducto(p: Pick<Product, "nombre" | "variante">): string {
  return `${p.nombre}${p.variante ? ` · ${p.variante}` : ""}`;
}

/* Alta y edición de una venta. El producto se elige con un buscador (el
   catálogo trae cientos de variantes; un Select plano no sirve). */
export function VentaDialog({
  venta,
  productos,
  clientes,
  gestor,
  onClose,
}: {
  venta: SaleConProducto | null; // null = alta
  productos: Pick<Product, "id" | "nombre" | "variante" | "sku" | "precio" | "activo">[];
  clientes: Pick<Customer, "id" | "nombre" | "correo" | "telefono">[];
  gestor: boolean;
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [fecha, setFecha] = useState(venta?.fecha ?? hoyISO());
  const [canal, setCanal] = useState<CanalId>(venta?.canal ?? "punto_fisico");
  const [productoId, setProductoId] = useState<string | null>(venta?.producto_id ?? null);
  const [descripcion, setDescripcion] = useState(venta?.descripcion ?? "");
  const [cantidad, setCantidad] = useState(venta?.cantidad?.toString() ?? "1");
  const [monto, setMonto] = useState(venta?.monto?.toString() ?? "");
  const [montoTocado, setMontoTocado] = useState(!!venta);
  const [notas, setNotas] = useState(venta?.notas ?? "");
  const [busqueda, setBusqueda] = useState("");

  /* Cliente (opcional): buscador con alta rápida. `lista` permite mostrar al
     recién creado sin recargar la página. */
  const [lista, setLista] = useState(clientes);
  const [clienteId, setClienteId] = useState<string | null>(venta?.cliente_id ?? null);
  const [busquedaCliente, setBusquedaCliente] = useState("");
  const [creandoCliente, setCreandoCliente] = useState(false);

  const seleccionado = productoId ? (productos.find((p) => p.id === productoId) ?? null) : null;

  const coincidencias = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (q.length < 2) return [];
    return productos
      .filter(
        (p) =>
          p.activo &&
          (p.nombre.toLowerCase().includes(q) ||
            (p.variante ?? "").toLowerCase().includes(q) ||
            (p.sku ?? "").toLowerCase().includes(q)),
      )
      .slice(0, 8);
  }, [busqueda, productos]);

  /* Autollenar monto = precio × cantidad mientras el usuario no lo haya tocado. */
  function recalcularMonto(prod: typeof seleccionado, cant: string, tocado: boolean) {
    if (tocado || !prod?.precio) return;
    const n = Math.max(1, Math.trunc(aNumero(cant) ?? 0));
    setMonto((prod.precio * n).toFixed(2));
  }

  function elegirProducto(p: (typeof productos)[number]) {
    setProductoId(p.id);
    setBusqueda("");
    recalcularMonto(p, cantidad, montoTocado);
  }

  const clienteSel = clienteId ? (lista.find((c) => c.id === clienteId) ?? null) : null;

  const clientesCoincidentes = useMemo(() => {
    const q = busquedaCliente.trim().toLowerCase();
    if (q.length < 2) return [];
    return lista
      .filter(
        (c) =>
          c.nombre.toLowerCase().includes(q) ||
          (c.correo ?? "").toLowerCase().includes(q) ||
          (c.telefono ?? "").toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [busquedaCliente, lista]);

  async function altaRapidaCliente() {
    const nombre = busquedaCliente.trim();
    if (!nombre) return;
    setCreandoCliente(true);
    try {
      const r = await crearClienteRapido(nombre, canal);
      if ("error" in r) {
        toast.error(r.error);
        return;
      }
      setLista((prev) => [...prev, r.cliente]);
      setClienteId(r.cliente.id);
      setBusquedaCliente("");
      toast.success("Cliente creado.");
    } catch {
      toast.error("No se pudo crear el cliente.");
    } finally {
      setCreandoCliente(false);
    }
  }

  function guardar() {
    const input: VentaInput = {
      fecha,
      canal,
      producto_id: productoId,
      descripcion,
      cantidad: Math.max(1, Math.trunc(aNumero(cantidad) ?? 0)),
      monto: Math.round((aNumero(monto) ?? 0) * 100) / 100,
      cliente_id: clienteId,
      notas,
    };
    ejecutar(() => (venta ? editarVenta(venta.id, input) : registrarVenta(input)), {
      ok: venta ? "Venta actualizada." : "Venta registrada.",
      error: "No se pudo guardar. Revisa tu conexión.",
      alExito: onClose,
    });
  }

  function borrar() {
    if (!venta) return;
    ejecutar(() => borrarVenta(venta.id), {
      confirmar: "¿Borrar esta venta? Esto no se puede deshacer.",
      ok: "Venta borrada.",
      error: "No se pudo borrar. Revisa tu conexión.",
      alExito: onClose,
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{venta ? "Editar venta" : "Registrar venta"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {venta?.origen === "api" && (
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              Venta importada de {venta.canal === "tienda_nube" ? "Tienda Nube" : "una plataforma"}
              {venta.referencia_externa ? ` (ref. ${venta.referencia_externa})` : ""}. Si la orden
              cambia allá, la sincronización puede volver a ajustarla.
            </p>
          )}

          {/* Producto: chip seleccionado o buscador */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="venta-producto">Producto</Label>
            {seleccionado ? (
              <div className="flex items-center gap-2">
                <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary bg-primary/10 px-3 py-1 text-sm font-medium">
                  <span className="truncate">{etiquetaProducto(seleccionado)}</span>
                  <button
                    type="button"
                    onClick={() => setProductoId(null)}
                    aria-label="Quitar producto"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              </div>
            ) : (
              <div className="relative">
                <Input
                  id="venta-producto"
                  autoFocus={!venta}
                  placeholder="Busca por nombre, variante o SKU…"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                />
                {coincidencias.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border bg-popover shadow-md">
                    {coincidencias.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => elegirProducto(p)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
                      >
                        <span className="truncate">{etiquetaProducto(p)}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {p.precio ? formatearMXN(p.precio) : (p.sku ?? "")}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {!seleccionado && (
              <Input
                placeholder="…o describe qué se vendió (fuera de catálogo)"
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-1">
              <Label>Canal</Label>
              <Select value={canal} onValueChange={(v) => v && setCanal(v as CanalId)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => CANALES.find((c) => c.id === v)?.nombre ?? "Canal"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CANALES.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="venta-fecha">Fecha</Label>
              <DatePicker id="venta-fecha" value={fecha} onChange={setFecha} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="venta-cantidad">Cantidad</Label>
              <Input
                id="venta-cantidad"
                type="number"
                min="1"
                step="1"
                value={cantidad}
                onChange={(e) => {
                  setCantidad(e.target.value);
                  recalcularMonto(seleccionado, e.target.value, montoTocado);
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="venta-monto">Total ($)</Label>
              <Input
                id="venta-monto"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={monto}
                onChange={(e) => {
                  setMontoTocado(true);
                  setMonto(e.target.value);
                }}
              />
            </div>
          </div>

          {/* Cliente (opcional): buscador + alta rápida con solo el nombre. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="venta-cliente">Cliente (opcional)</Label>
            {clienteSel ? (
              <span className="inline-flex w-fit max-w-full items-center gap-1.5 rounded-full border border-primary bg-primary/10 px-3 py-1 text-sm font-medium">
                <span className="truncate">{clienteSel.nombre}</span>
                <button
                  type="button"
                  onClick={() => setClienteId(null)}
                  aria-label="Quitar cliente"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ) : (
              <div className="relative">
                <Input
                  id="venta-cliente"
                  placeholder="Busca por nombre, correo o teléfono…"
                  value={busquedaCliente}
                  onChange={(e) => setBusquedaCliente(e.target.value)}
                />
                {busquedaCliente.trim().length >= 2 && (
                  <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border bg-popover shadow-md">
                    {clientesCoincidentes.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setClienteId(c.id);
                          setBusquedaCliente("");
                        }}
                        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
                      >
                        <span className="truncate">{c.nombre}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {c.correo ?? c.telefono ?? ""}
                        </span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={altaRapidaCliente}
                      disabled={creandoCliente}
                      className="flex w-full items-center gap-1.5 border-t px-3 py-1.5 text-left text-sm font-semibold text-primary hover:bg-accent disabled:opacity-60"
                    >
                      <Plus className="size-3.5" />
                      {creandoCliente ? "Creando…" : `Crear «${busquedaCliente.trim()}»`}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="venta-notas">Notas (opcional)</Label>
            <Input
              id="venta-notas"
              placeholder="Mayoreo, cliente frecuente…"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
            />
          </div>
        </div>

        <PieDialogoCRUD
          pending={pending}
          etiquetaGuardar={venta ? "Guardar cambios" : "Registrar venta"}
          onGuardar={guardar}
          onCancelar={onClose}
          onBorrar={venta && gestor ? borrar : undefined}
        />
      </DialogContent>
    </Dialog>
  );
}
