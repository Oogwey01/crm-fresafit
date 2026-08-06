"use client";

import { useMemo, useState } from "react";
import { Plus, Unlock, X } from "lucide-react";
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
import { useDetalleRemoto } from "@/components/compartido/use-detalle-remoto";
import { PieDialogoCRUD } from "@/components/compartido/pie-dialogo-crud";
import { aNumero } from "@/lib/validacion";
import { CANALES, obtenerCanal } from "@/lib/catalogos";
import { cn } from "@/lib/utils";
import { hoyISO } from "@/lib/fecha";
import { formatearMXN } from "@/lib/moneda";
import {
  registrarVenta,
  editarVenta,
  borrarVenta,
  catalogoVenta,
  type VentaInput,
} from "@/app/(app)/metricas/actions";
import { crearClienteRapido } from "@/app/(app)/clientes/actions";
import type { CanalId, Customer, Product, VentaMetricas } from "@/lib/types";

function etiquetaProducto(p: Pick<Product, "nombre" | "variante">): string {
  return `${p.nombre}${p.variante ? ` · ${p.variante}` : ""}`;
}

/* Alta y edición de una venta. El producto se elige con un buscador (el
   catálogo trae cientos de variantes; un Select plano no sirve). */
export function VentaDialog({
  venta,
  gestor,
  direccion = false,
  verDinero = true,
  onClose,
}: {
  venta: VentaMetricas | null; // null = alta
  gestor: boolean;
  direccion?: boolean; // solo Dirección puede corregir a mano una venta importada
  /* ¿Quien captura puede VER los importes? Capturar uno nuevo sí puede
     cualquiera —eso es registrar, no revelar—; lo que no puede es reescribir el
     de una venta existente que nunca vio. */
  verDinero?: boolean;
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();

  /* El catálogo y la lista de clientes se piden AL ABRIR el diálogo. Antes
     viajaban con la página de Métricas —miles de filas serializadas en cada
     carga— para alimentar dos buscadores que ni siquiera responden hasta la
     segunda letra que tecleas. */
  const { datos: catalogo, cargando: cargandoCatalogo } = useDetalleRemoto(
    () => catalogoVenta().then((r) => ("error" in r ? null : r)),
    "catalogo-venta",
  );
  const productos = useMemo(() => catalogo?.productos ?? [], [catalogo]);
  const [fecha, setFecha] = useState(venta?.fecha ?? hoyISO());
  const [canal, setCanal] = useState<CanalId>(venta?.canal ?? "punto_fisico");
  const [productoId, setProductoId] = useState<string | null>(venta?.producto_id ?? null);
  const [descripcion, setDescripcion] = useState(venta?.descripcion ?? "");
  const [cantidad, setCantidad] = useState(venta?.cantidad?.toString() ?? "1");
  const [monto, setMonto] = useState(venta?.monto?.toString() ?? "");
  const [montoTocado, setMontoTocado] = useState(!!venta);
  const [notas, setNotas] = useState(venta?.notas ?? "");
  const [busqueda, setBusqueda] = useState("");

  /* Cliente (opcional): buscador con alta rápida. Los creados aquí se anteponen
     a la lista traída para poder elegirlos sin recargar la página. */
  const [reciencreados, setReciencreados] = useState<
    Pick<Customer, "id" | "nombre" | "correo" | "telefono">[]
  >([]);
  const lista = useMemo(
    () => [...reciencreados, ...(catalogo?.clientes ?? [])],
    [reciencreados, catalogo],
  );
  const [clienteId, setClienteId] = useState<string | null>(venta?.cliente_id ?? null);
  const [busquedaCliente, setBusquedaCliente] = useState("");
  const [creandoCliente, setCreandoCliente] = useState(false);

  const seleccionado = productoId ? (productos.find((p) => p.id === productoId) ?? null) : null;

  /* Una venta traída de un canal la manda la plataforma, no el CRM. Editar aquí
     su precio o su cantidad descuadraba el CRM contra el canal para siempre: la
     re-sincronización no pisa renglones ya existentes, así que el cambio nunca
     se revertía y nadie se enteraba. Se quedan de solo lectura los campos que
     dicta el canal; el cliente y las notas sí son del equipo.

     Dirección conserva la llave —a veces hay que corregir algo a mano— pero
     detrás de un clic explícito: que el campo esté abierto de entrada invita a
     tocarlo sin querer, y ese fue justo el reclamo ("me deja modificar el precio
     y la cantidad… eso no debería estar ahí"). El servidor y la RLS aplican la
     misma regla; esto es la primera de las tres capas. */
  const importada = venta?.origen === "api";
  const [desbloqueado, setDesbloqueado] = useState(false);
  const bloqueado = importada && !desbloqueado;

  /* El campo del total desaparece al EDITAR si quien mira no ve los importes: su
     monto nunca llegó del servidor, así que el campo saldría vacío y guardar
     dejaría la venta en cero sin que nadie lo pidiera. Al dar de alta sí se
     pide, porque ahí el número lo pone quien captura. El servidor conserva el
     monto anterior aunque llegue vacío; esto es la primera de las dos capas. */
  const pedirMonto = verDinero || !venta;
  const nombreCanal = venta ? (obtenerCanal(venta.canal)?.nombre ?? "la plataforma") : "";

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
      setReciencreados((prev) => [...prev, r.cliente]);
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
          {importada && (
            <div
              className={cn(
                "rounded-lg px-3 py-2 text-xs",
                bloqueado
                  ? "bg-muted text-muted-foreground"
                  : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
              )}
            >
              <p className="wrap-anywhere">
                Venta importada de {nombreCanal}
                {venta?.referencia_externa ? ` (ref. ${venta.referencia_externa})` : ""}.{" "}
                {bloqueado
                  ? "Producto, canal, fecha, cantidad y total los manda la plataforma: aquí solo se editan el cliente y las notas."
                  : "Edición manual abierta: lo que cambies dejará de coincidir con la plataforma y la sincronización no lo va a revertir."}
              </p>
              {/* La llave es de Dirección, y solo aparece mientras está cerrada. */}
              {bloqueado && direccion && (
                <button
                  type="button"
                  onClick={() => setDesbloqueado(true)}
                  className="mt-1.5 inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                >
                  <Unlock className="size-3" />
                  Corregir a mano
                </button>
              )}
            </div>
          )}

          {/* Producto: chip seleccionado o buscador */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="venta-producto">Producto</Label>
            {cargandoCatalogo && productoId ? (
              /* La venta trae producto pero el catálogo aún viene en camino:
                 decirlo en vez de enseñar el buscador vacío, que se lee como
                 «esta venta no tiene producto». */
              <p className="text-sm text-muted-foreground">Cargando el producto…</p>
            ) : seleccionado ? (
              <div className="flex items-center gap-2">
                <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary bg-primary/10 px-3 py-1 text-sm font-medium">
                  <span className="truncate">{etiquetaProducto(seleccionado)}</span>
                  {!bloqueado && (
                    <button
                      type="button"
                      onClick={() => setProductoId(null)}
                      aria-label="Quitar producto"
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </span>
              </div>
            ) : bloqueado ? (
              /* Sin producto del catálogo: la descripción que mandó el canal. */
              <p className="text-sm text-muted-foreground">{venta?.descripcion ?? "Sin producto"}</p>
            ) : (
              <div className="relative">
                <Input
                  id="venta-producto"
                  autoFocus={!venta}
                  placeholder={
                    cargandoCatalogo
                      ? "Cargando catálogo…"
                      : "Busca por nombre, variante o SKU…"
                  }
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
            {!seleccionado && !bloqueado && (
              <Input
                placeholder="…o describe qué se vendió (fuera de catálogo)"
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
              />
            )}
          </div>

          <div className={cn("grid grid-cols-2 gap-3", pedirMonto ? "sm:grid-cols-4" : "sm:grid-cols-3")}>
            <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-1">
              <Label>Canal</Label>
              <Select
                value={canal}
                onValueChange={(v) => v && setCanal(v as CanalId)}
                disabled={bloqueado}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => obtenerCanal(v)?.nombre ?? "Canal"}
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
              <DatePicker id="venta-fecha" value={fecha} onChange={setFecha} disabled={bloqueado} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="venta-cantidad">Cantidad</Label>
              <Input
                id="venta-cantidad"
                type="number"
                min="1"
                step="1"
                value={cantidad}
                disabled={bloqueado}
                onChange={(e) => {
                  setCantidad(e.target.value);
                  recalcularMonto(seleccionado, e.target.value, montoTocado);
                }}
              />
            </div>
            {pedirMonto && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="venta-monto">Total ($)</Label>
                <Input
                  id="venta-monto"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={monto}
                  disabled={bloqueado}
                  onChange={(e) => {
                    setMontoTocado(true);
                    setMonto(e.target.value);
                  }}
                />
              </div>
            )}
          </div>

          {/* Cliente (opcional): buscador + alta rápida con solo el nombre. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="venta-cliente">Cliente (opcional)</Label>
            {cargandoCatalogo && clienteId ? (
              <p className="text-sm text-muted-foreground">Cargando el cliente…</p>
            ) : clienteSel ? (
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
                  placeholder={
                    cargandoCatalogo ? "Cargando clientes…" : "Busca por nombre, correo o teléfono…"
                  }
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
