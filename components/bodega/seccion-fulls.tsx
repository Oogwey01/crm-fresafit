"use client";

import { useId, useState } from "react";
import { ExternalLink, Package, Plus, Trash2 } from "lucide-react";
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
import { Pastilla } from "@/components/compartido/pastilla";
import { CampoBusqueda } from "@/components/compartido/campo-busqueda";
import { DatePicker } from "@/components/compartido/date-picker";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import {
  agregarCajaFull,
  agregarItemFull,
  borrarCajaFull,
  borrarEnvioFull,
  borrarItemFull,
  guardarCajaFull,
  guardarEnvioFull,
  marcarChecklistFull,
} from "@/app/(app)/bodega/actions";
import {
  DESTINOS_FULL,
  ESTADOS_ENVIO_FULL,
  PAQUETERIAS,
  TIPOS_ENVIO_FULL,
  obtenerEstadoEnvioFull,
} from "@/lib/catalogos";
import { coincide, terminosBusqueda } from "@/lib/busqueda";
import { matchProductoPorSku } from "@/lib/importar/tsv";
import { formatearFecha } from "@/lib/fecha";
import { urlRastreo } from "@/lib/pedidos/rastreo";
import { aNumero } from "@/lib/validacion";
import type { ProductoLigeroFila } from "@/app/(app)/bodega/page";
import type {
  DestinoFullId,
  EnvioFullConCajas,
  EstadoEnvioFullId,
} from "@/lib/types";

/* Envíos "full": el stock que se manda al centro de Amazon o Mercado Libre,
   caja por caja, con el checklist de «PASOS PARA UN FULL PERFECTO» de la hoja.
   El ASIN es solo un dato a la vista: el CRM no habla con Amazon. */
export function SeccionFulls({
  envios,
  productos,
}: {
  envios: EnvioFullConCajas[];
  productos: ProductoLigeroFila[];
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [dialogo, setDialogo] = useState(false);
  const [abiertoId, setAbiertoId] = useState<string | null>(envios[0]?.id ?? null);
  const [busqueda, setBusqueda] = useState("");

  /* El SKU y el ASIN de las cajas entran al comparador: la pregunta que se hace
     en el piso es «¿en qué envío se fue este cinturón?», y sin eso habría que
     abrir los envíos uno por uno para encontrarlo. */
  const terminos = terminosBusqueda(busqueda);
  const visibles = envios.filter((e) =>
    coincide(
      terminos,
      e.nombre,
      DESTINOS_FULL.find((d) => d.id === e.destino)?.nombre,
      obtenerEstadoEnvioFull(e.estado)?.nombre,
      e.id_plataforma,
      e.paqueteria,
      e.num_guia,
      e.notas,
      ...e.cajas.flatMap((c) => c.items.flatMap((i) => [i.sku, i.asin])),
    ),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <CampoBusqueda
          valor={busqueda}
          onCambio={setBusqueda}
          placeholder="Buscar envío, SKU, ASIN o guía…"
        />
        <p className="text-[13.5px] text-muted-foreground">
          {busqueda.trim()
            ? `${visibles.length} de ${envios.length}`
            : `${envios.length} ${envios.length === 1 ? "envío" : "envíos"}`}{" "}
          · el stock no se descuenta solo: márcalo en el checklist cuando lo hagas.
        </p>
        <div className="flex-1" />
        <Button onClick={() => setDialogo(true)}>
          <Plus className="size-4" /> Nuevo envío
        </Button>
      </div>

      {envios.length === 0 && (
        <div className="rounded-2xl border bg-card p-10 text-center shadow-sm">
          <p className="text-[15px] font-semibold">Todavía no hay envíos full.</p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Un envío full agrupa las cajas que se mandan al centro de la plataforma, con su SKU,
            ASIN y cantidad.
          </p>
        </div>
      )}

      {envios.length > 0 && visibles.length === 0 && (
        <div className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">
          Ningún envío coincide con «{busqueda.trim()}».
        </div>
      )}

      {visibles.map((e) => {
        const estado = obtenerEstadoEnvioFull(e.estado);
        const destino = DESTINOS_FULL.find((d) => d.id === e.destino);
        const abierto = abiertoId === e.id;
        const totalPiezas = e.cajas.reduce(
          (acc, c) => acc + c.items.reduce((a, i) => a + i.cantidad, 0),
          0,
        );

        return (
          <div key={e.id} className="rounded-2xl border bg-card shadow-sm">
            <button
              type="button"
              onClick={() => setAbiertoId(abierto ? null : e.id)}
              className="flex w-full flex-wrap items-center gap-3 px-5 py-3.5 text-left"
            >
              <Package className="size-4 text-muted-foreground" strokeWidth={1.9} />
              <div className="min-w-0">
                <div className="truncate font-semibold">{e.nombre}</div>
                <div className="text-[12.5px] text-muted-foreground">
                  {destino?.nombre} · {e.cajas.length} {e.cajas.length === 1 ? "caja" : "cajas"} ·{" "}
                  {totalPiezas} piezas
                  {e.fecha_envio && ` · ${formatearFecha(e.fecha_envio)}`}
                </div>
              </div>
              <div className="ml-auto flex items-center gap-2">
                {estado && <Pastilla nombre={estado.nombre} color={estado.color} />}
              </div>
            </button>

            {abierto && (
              <div className="border-t px-5 py-3">
                <DatosEnvio envio={e} ejecutar={ejecutar} />
                {e.cajas.map((caja) => (
                  <Caja
                    key={caja.id}
                    caja={caja}
                    productos={productos}
                    pending={pending}
                    ejecutar={ejecutar}
                  />
                ))}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => ejecutar(() => agregarCajaFull(e.id), { ok: "Caja agregada." })}
                  >
                    + Caja
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      ejecutar(() => borrarEnvioFull(e.id), {
                        confirmar: `¿Borrar el envío «${e.nombre}» con sus cajas?`,
                        ok: "Envío borrado.",
                      })
                    }
                  >
                    <Trash2 className="size-4" /> Borrar envío
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {dialogo && <DialogoEnvio onClose={() => setDialogo(false)} />}
    </div>
  );
}

/* --- Una caja con sus renglones y el checklist ---------------------------- */
type Ejecutar = ReturnType<typeof useAccionServidor>["ejecutar"];

/* --- La guía del envío ----------------------------------------------------
   Lo que la hoja llevaba a mano por envío: el ID que da la plataforma, con qué
   paquetería va, el número de rastreo y las dos fechas. Es captura manual de
   principio a fin —el CRM no habla con Amazon ni con la paquetería—, así que se
   guarda campo por campo al salir de cada uno: los datos van llegando de a poco
   y nadie va a esperar a tenerlos todos para apretar un botón. */
function DatosEnvio({ envio, ejecutar }: { envio: EnvioFullConCajas; ejecutar: Ejecutar }) {
  const idListaPaqueterias = useId();
  const idListaTipos = useId();
  const guardado = {
    id_plataforma: envio.id_plataforma ?? "",
    paqueteria: envio.paqueteria ?? "",
    tipo_envio: envio.tipo_envio ?? "",
    num_guia: envio.num_guia ?? "",
    fecha_envio: envio.fecha_envio ?? "",
    fecha_llegada_estimada: envio.fecha_llegada_estimada ?? "",
    estado: envio.estado,
    notas: envio.notas ?? "",
  };
  const [campos, setCampos] = useState(guardado);

  /* Sobre lo GUARDADO, no sobre lo que se está tecleando: el enlace lleva al
     paquete que de verdad quedó registrado. */
  const rastreo = urlRastreo(envio.paqueteria, envio.num_guia);

  function guardar(parche: Partial<typeof campos> = {}) {
    const c = { ...campos, ...parche };
    /* Salir de un campo sin haberlo tocado —tabular por la ficha para leerla—
       no tiene por qué escribir en la base ni revalidar la página. */
    const claves = Object.keys(guardado) as (keyof typeof guardado)[];
    if (claves.every((k) => c[k].trim() === guardado[k].trim())) return;

    ejecutar(() =>
      guardarEnvioFull(envio.id, {
        destino: envio.destino,
        nombre: envio.nombre,
        estado: c.estado,
        fecha_envio: c.fecha_envio || null,
        id_plataforma: c.id_plataforma,
        paqueteria: c.paqueteria,
        tipo_envio: c.tipo_envio,
        num_guia: c.num_guia,
        fecha_llegada_estimada: c.fecha_llegada_estimada || null,
        notas: c.notas,
      }),
    );
  }

  const set = (parche: Partial<typeof campos>) => setCampos((c) => ({ ...c, ...parche }));

  return (
    <div className="mb-3 grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-3">
      <Campo etiqueta="ID de envío" htmlFor={`${envio.id}-id`}>
        <Input
          id={`${envio.id}-id`}
          className="font-mono"
          placeholder="71411091"
          value={campos.id_plataforma}
          onChange={(e) => set({ id_plataforma: e.target.value })}
          onBlur={() => guardar()}
        />
      </Campo>

      <Campo etiqueta="Paquetería" htmlFor={`${envio.id}-paqueteria`}>
        <Input
          id={`${envio.id}-paqueteria`}
          list={idListaPaqueterias}
          placeholder="Estafeta, DHL…"
          value={campos.paqueteria}
          onChange={(e) => set({ paqueteria: e.target.value })}
          onBlur={() => guardar()}
        />
        <datalist id={idListaPaqueterias}>
          {PAQUETERIAS.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </Campo>

      <Campo etiqueta="Tipo de envío" htmlFor={`${envio.id}-tipo`}>
        <Input
          id={`${envio.id}-tipo`}
          list={idListaTipos}
          placeholder="Terrestre"
          value={campos.tipo_envio}
          onChange={(e) => set({ tipo_envio: e.target.value })}
          onBlur={() => guardar()}
        />
        <datalist id={idListaTipos}>
          {TIPOS_ENVIO_FULL.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </Campo>

      <Campo etiqueta="Número de rastreo" htmlFor={`${envio.id}-guia`}>
        <Input
          id={`${envio.id}-guia`}
          className="font-mono"
          placeholder="4058709800610709711592"
          value={campos.num_guia}
          onChange={(e) => set({ num_guia: e.target.value })}
          onBlur={() => guardar()}
        />
        {rastreo && (
          <a
            href={rastreo}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-1 text-[12px] font-medium text-primary hover:underline"
          >
            <ExternalLink className="size-3.5" />
            Ver dónde va la caja
          </a>
        )}
      </Campo>

      <Campo etiqueta="F. de envío" htmlFor={`${envio.id}-fecha-envio`}>
        <DatePicker
          id={`${envio.id}-fecha-envio`}
          value={campos.fecha_envio}
          onChange={(v) => {
            set({ fecha_envio: v });
            guardar({ fecha_envio: v });
          }}
          limpiable
        />
      </Campo>

      <Campo etiqueta="F. est. llegada" htmlFor={`${envio.id}-fecha-llegada`}>
        <DatePicker
          id={`${envio.id}-fecha-llegada`}
          value={campos.fecha_llegada_estimada}
          min={campos.fecha_envio || undefined}
          onChange={(v) => {
            set({ fecha_llegada_estimada: v });
            guardar({ fecha_llegada_estimada: v });
          }}
          limpiable
        />
      </Campo>

      <Campo etiqueta="Estado">
        <Select
          value={campos.estado}
          onValueChange={(v) => {
            if (!v) return;
            set({ estado: v as EstadoEnvioFullId });
            guardar({ estado: v as EstadoEnvioFullId });
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue>{(v: string) => obtenerEstadoEnvioFull(v)?.nombre ?? "Estado"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {ESTADOS_ENVIO_FULL.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Campo>

      <Campo etiqueta="Notas" htmlFor={`${envio.id}-notas`}>
        <Input
          id={`${envio.id}-notas`}
          placeholder="Lo que haya que recordar del envío"
          value={campos.notas}
          onChange={(e) => set({ notas: e.target.value })}
          onBlur={() => guardar()}
        />
      </Campo>
    </div>
  );
}

function Campo({
  etiqueta,
  htmlFor,
  children,
}: {
  etiqueta: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label
        htmlFor={htmlFor}
        className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
      >
        {etiqueta}
      </Label>
      {children}
    </div>
  );
}

function Caja({
  caja,
  productos,
  pending,
  ejecutar,
}: {
  caja: EnvioFullConCajas["cajas"][number];
  productos: ProductoLigeroFila[];
  pending: boolean;
  ejecutar: Ejecutar;
}) {
  /* Las tres medidas van por separado, en el orden en que las pide la etiqueta
     de guía (largo × ancho × alto). Antes era un solo texto libre: servía para
     leerlo y para nada más. */
  const guardadas = {
    largo: caja.largo_cm?.toString() ?? "",
    ancho: caja.ancho_cm?.toString() ?? "",
    alto: caja.alto_cm?.toString() ?? "",
    peso: caja.peso_kg?.toString() ?? "",
  };
  const [medidas, setMedidas] = useState(guardadas);
  const [sku, setSku] = useState("");
  const [asin, setAsin] = useState("");
  const [cantidad, setCantidad] = useState("1");

  const medida = (campo: keyof typeof medidas) => ({
    type: "number" as const,
    min: "0",
    step: "0.1",
    className: "h-8 w-[72px]",
    value: medidas[campo],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setMedidas((m) => ({ ...m, [campo]: e.target.value })),
    onBlur: () => guardarMedidas(),
  });

  function guardarMedidas() {
    /* Igual que en la ficha del envío: pasar por el campo sin cambiarlo no
       escribe. Se comparan los números, no el texto: "40" y "40.0" son la
       misma caja. */
    const claves = Object.keys(guardadas) as (keyof typeof guardadas)[];
    if (claves.every((k) => aNumero(medidas[k]) === aNumero(guardadas[k]))) return;

    ejecutar(() =>
      guardarCajaFull(caja.id, {
        largo_cm: aNumero(medidas.largo),
        ancho_cm: aNumero(medidas.ancho),
        alto_cm: aNumero(medidas.alto),
        peso_kg: aNumero(medidas.peso),
      }),
    );
  }

  /* Sobre lo guardado: es el dato con el que cotiza la paquetería. */
  const volumen =
    caja.largo_cm && caja.ancho_cm && caja.alto_cm
      ? (caja.largo_cm * caja.ancho_cm * caja.alto_cm) / 1_000_000
      : null;

  return (
    <div className="mb-3 rounded-lg border bg-muted/20 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-bold">Caja {caja.numero}</span>
        <div className="flex items-center gap-1">
          <Input placeholder="Largo" aria-label="Largo en centímetros" {...medida("largo")} />
          <span className="text-muted-foreground">×</span>
          <Input placeholder="Ancho" aria-label="Ancho en centímetros" {...medida("ancho")} />
          <span className="text-muted-foreground">×</span>
          <Input placeholder="Alto" aria-label="Alto en centímetros" {...medida("alto")} />
          <span className="text-[12px] text-muted-foreground">cm</span>
        </div>
        <Input
          placeholder="Peso kg"
          aria-label="Peso en kilos"
          {...medida("peso")}
          step="0.01"
          className="h-8 w-[92px]"
        />
        {volumen !== null && (
          <span className="text-[12px] tabular-nums text-muted-foreground">
            {volumen.toFixed(3)} m³
          </span>
        )}
        <button
          type="button"
          onClick={() =>
            ejecutar(() => borrarCajaFull(caja.id), {
              confirmar: `¿Borrar la caja ${caja.numero} y su contenido?`,
            })
          }
          className="ml-auto text-muted-foreground hover:text-destructive"
          aria-label="Borrar caja"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      {caja.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-1.5 font-semibold">SKU</th>
                <th className="py-1.5 font-semibold">ASIN</th>
                <th className="py-1.5 text-right font-semibold">Cant.</th>
                <th className="py-1.5 text-center font-semibold">Empaquetado</th>
                <th className="py-1.5 text-center font-semibold">Cancelado</th>
                <th className="py-1.5 text-center font-semibold">Descontado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {caja.items.map((i) => (
                <tr key={i.id} className="border-t">
                  <td className="py-1.5 font-mono text-[12.5px]">{i.sku}</td>
                  <td className="py-1.5 font-mono text-[12px] text-muted-foreground">
                    {i.asin ?? "—"}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{i.cantidad}</td>
                  {(["empaquetado", "cancelado", "descontado"] as const).map((campo) => (
                    <td key={campo} className="py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={i[campo]}
                        disabled={pending}
                        onChange={(e) =>
                          ejecutar(() => marcarChecklistFull(i.id, campo, e.target.checked))
                        }
                        className="size-4 accent-primary"
                        aria-label={campo}
                      />
                    </td>
                  ))}
                  <td className="py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => ejecutar(() => borrarItemFull(i.id))}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Quitar renglón"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Input
          placeholder="SKU"
          className="h-8 w-[130px] font-mono"
          value={sku}
          onChange={(e) => setSku(e.target.value.toUpperCase())}
        />
        <Input
          placeholder="ASIN"
          className="h-8 w-[130px] font-mono"
          value={asin}
          onChange={(e) => setAsin(e.target.value.toUpperCase())}
        />
        <Input
          type="number"
          min="1"
          className="h-8 w-20"
          aria-label="Cantidad"
          value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={pending || !sku.trim()}
          onClick={() =>
            ejecutar(
              () =>
                agregarItemFull({
                  caja_id: caja.id,
                  producto_id: matchProductoPorSku(sku, productos).producto?.id ?? null,
                  sku,
                  asin,
                  cantidad: Number(cantidad) || 0,
                }),
              {
                alExito: () => {
                  setSku("");
                  setAsin("");
                  setCantidad("1");
                },
              },
            )
          }
        >
          Agregar
        </Button>
      </div>
    </div>
  );
}

/* --- Alta de envío -------------------------------------------------------- */
function DialogoEnvio({ onClose }: { onClose: () => void }) {
  const { pending, ejecutar } = useAccionServidor();
  const [destino, setDestino] = useState<DestinoFullId>("amazon");
  const [nombre, setNombre] = useState("");
  const [estado, setEstado] = useState<EstadoEnvioFullId>("preparando");
  const [fecha, setFecha] = useState("");

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo envío full</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ef-nombre">Nombre</Label>
            <Input
              id="ef-nombre"
              autoFocus
              placeholder="Full agosto · hebillas"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Destino</Label>
              <Select value={destino} onValueChange={(v) => v && setDestino(v as DestinoFullId)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => DESTINOS_FULL.find((d) => d.id === v)?.nombre ?? "Destino"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {DESTINOS_FULL.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Estado</Label>
              <Select value={estado} onValueChange={(v) => v && setEstado(v as EstadoEnvioFullId)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => obtenerEstadoEnvioFull(v)?.nombre ?? "Estado"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ESTADOS_ENVIO_FULL.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ef-fecha">Fecha de envío</Label>
            <DatePicker id="ef-fecha" value={fecha} onChange={setFecha} limpiable />
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
                () =>
                  /* La guía (paquetería, rastreo, fecha de llegada) se captura
                     después, en el envío ya abierto: al crearlo todavía no
                     existe. */
                  guardarEnvioFull(null, {
                    destino,
                    nombre,
                    estado,
                    fecha_envio: fecha || null,
                    id_plataforma: "",
                    paqueteria: "",
                    tipo_envio: "",
                    num_guia: "",
                    fecha_llegada_estimada: null,
                    notas: "",
                  }),
                { ok: "Envío creado.", error: "No se pudo crear. Revisa tu conexión.", alExito: onClose },
              )
            }
          >
            {pending ? "Guardando…" : "Crear envío"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
