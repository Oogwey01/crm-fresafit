"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, Clock, ExternalLink, Eye, PackageCheck, Printer, Search, Send, Truck } from "lucide-react";
import { toast } from "sonner";
import { CANALES, ESTADOS_PEDIDO, esGestor, obtenerCanal, obtenerEstadoPedido } from "@/lib/catalogos";
import { esPedidoAtrasado, formatearFecha, formatearFechaHora } from "@/lib/fecha";
import { SITUACION, situacionDespacho } from "@/lib/mercadolibre/desempeno";
import { nombreVenta } from "@/lib/ventas";
import { urlOrdenCanal, urlRastreo } from "@/lib/pedidos/rastreo";
import { cambiarEstadoPedido, listarPedidosHistorico } from "@/app/(app)/pedidos/actions";
import type { CanalId, EstadoPedidoId, RolId, PedidoEnvio } from "@/lib/types";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pastilla } from "@/components/compartido/pastilla";
import { StatCard } from "@/components/compartido/stat-card";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { EnvioDialog } from "@/components/pedidos/envio-dialog";
import { cn } from "@/lib/utils";

type Filtro = "pendientes" | "todos" | "entregado";

const FILTROS: [Filtro, string][] = [
  ["pendientes", "Pendientes"],
  ["todos", "Todos"],
  ["entregado", "Entregados"],
];

/* La última columna llevaba 60 px y el envío ("Estafeta MX 905590979741C70…")
   salía cortado sin remedio; ahora es la más ancha de la fila, que es lo que
   corresponde a la información con la que uno trabaja al empacar. La primera
   creció de 88 a 112 px para que quepa la pastilla del plazo de despacho. */
const COLS = "grid-cols-[112px_minmax(170px,1fr)_130px_120px_118px_minmax(215px,250px)]";

/* `referencia_externa` es por RENGLÓN ("<orden>:<línea>"); lo que identifica al
   pedido de cara al cliente es la parte de la orden. */
function numeroOrden(ref: string): string {
  return ref.split(":")[0];
}

/* La guía imprimible DIRECTA: solo cuando el clic de verdad entrega la
   etiqueta (hoy: Mercado Libre con id de envío → PDF de su API). Cuando no la
   hay, la impresora no se pinta — mandar "imprimir" al detalle del pedido
   confundía, era un "ver pedido" disfrazado. */
function urlEtiquetaDirecta(p: PedidoEnvio): string | null {
  if (p.estado !== "nuevo" && p.estado !== "preparando") return null;
  if (p.canal === "mercado_libre" && p.envio_id) {
    return `/api/mercadolibre/etiqueta?envio=${encodeURIComponent(p.envio_id)}`;
  }
  return null;
}

/* "Ver pedido": la orden en el panel del canal, que es donde se imprime la
   guía cuando no hay PDF directo. Tienda Nube va por la ruta de etiqueta: hoy
   redirige al admin (Envío Nube no publica el PDF en la API), y el día que lo
   publique, este mismo enlace lo entregará sin tocar nada. */
function urlVerPedido(p: PedidoEnvio, dominioTN?: string | null): string | null {
  const ref = p.referencia_externa ? numeroOrden(p.referencia_externa) : "";
  if (p.canal === "tienda_nube" && /^\d+$/.test(ref)) {
    return `/api/tiendanube/etiqueta?orden=${encodeURIComponent(ref)}`;
  }
  return urlOrdenCanal(p.canal, ref, dominioTN, p.url_orden);
}

/* Plazo de despacho de Mercado Libre (la sync lo deja en la venta): solo avisa
   mientras el pedido da trabajo —nuevo o preparando— y solo cuando urge. Ya
   enviado, "se pasó el plazo" es ruido; en plazo holgado, también. */
function plazoUrgente(p: PedidoEnvio, ahora: number): "vencido" | "por_vencer" | null {
  if (p.estado !== "nuevo" && p.estado !== "preparando") return null;
  const s = situacionDespacho(p.envio_limite_despacho, p.envio_despachado_en, ahora);
  return s === "vencido" || s === "por_vencer" ? s : null;
}

function PastillaEstado({ estado }: { estado: string }) {
  const e = obtenerEstadoPedido(estado);
  if (!e) return null;
  return <Pastilla nombre={e.nombre} color={e.color} />;
}

export function PanelPedidos({
  pedidos,
  rol,
  dominioTiendaNube,
  ahora,
}: {
  pedidos: PedidoEnvio[];
  rol: RolId;
  /* Subdominio del panel de la tienda; sin él no se puede enlazar la orden de
     Tienda Nube (cada tienda tiene el suyo). Ver app/(app)/pedidos/page.tsx. */
  dominioTiendaNube?: string | null;
  /* Un solo "ahora" tomado por request en el servidor: dos pedidos con el mismo
     plazo de despacho deben clasificar igual (mismo criterio que el tablero de
     ML, ver instanteDeCorte). */
  ahora: number;
}) {
  const gestor = esGestor(rol);
  const [filtro, setFiltro] = useState<Filtro>("pendientes");
  const [filtroCanal, setFiltroCanal] = useState<CanalId | "todos">("todos");
  const [busqueda, setBusqueda] = useState("");
  const [envio, setEnvio] = useState<PedidoEnvio | null>(null);
  const [, startTransition] = useTransition();

  /* La página ya solo carga lo que da trabajo; los entregados y cancelados de
     la ventana se piden UNA vez, la primera vez que alguien sale del filtro de
     pendientes. `null` = aún no se han pedido. */
  const [historico, setHistorico] = useState<PedidoEnvio[] | null>(null);
  const [cargandoHistorico, setCargandoHistorico] = useState(false);

  async function asegurarHistorico() {
    if (historico !== null || cargandoHistorico) return;
    setCargandoHistorico(true);
    try {
      const r = await listarPedidosHistorico();
      if ("error" in r) toast.error(r.error);
      else setHistorico(r.pedidos);
    } catch {
      toast.error("No se pudo cargar el histórico. Revisa tu conexión.");
    } finally {
      setCargandoHistorico(false);
    }
  }

  /* Activos + histórico, sin repetir (si un pedido está en ambos, manda la
     copia activa: es la más fresca) y en el mismo orden que trae el servidor. */
  const conHistorico = useMemo(() => {
    if (!historico) return pedidos;
    const porId = new Map<string, PedidoEnvio>();
    for (const p of historico) porId.set(p.id, p);
    for (const p of pedidos) porId.set(p.id, p);
    return [...porId.values()].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
  }, [pedidos, historico]);

  const conteo = useMemo(() => {
    let nuevos = 0,
      preparando = 0,
      enviados = 0,
      atrasados = 0;
    for (const p of pedidos) {
      if (p.estado === "nuevo") nuevos++;
      else if (p.estado === "preparando") preparando++;
      else if (p.estado === "enviado") enviados++;
      if (esPedidoAtrasado(p.fecha, p.estado)) atrasados++;
    }
    return { nuevos, preparando, enviados, atrasados };
  }, [pedidos]);

  const visibles = useMemo(() => {
    const porEstado =
      filtro === "entregado"
        ? conHistorico.filter((p) => p.estado === "entregado")
        : filtro === "todos"
          ? conHistorico
          : // pendientes: nuevo, preparando, enviado (lo que aún da trabajo)
            pedidos.filter(
              (p) => p.estado === "nuevo" || p.estado === "preparando" || p.estado === "enviado",
            );

    /* Filtro por canal: hasta ahora el canal se pintaba pero no se podía filtrar,
       y "enséñame solo lo de Mercado Libre" es justo lo que se pide al empacar. */
    const porCanal =
      filtroCanal === "todos" ? porEstado : porEstado.filter((p) => p.canal === filtroCanal);

    const q = busqueda.trim().toLowerCase();
    if (!q) return porCanal;
    /* Se busca por lo que uno tiene a mano cuando pregunta por un pedido: el
       nombre del cliente, el número de guía o la referencia de la orden. */
    return porCanal.filter(
      (p) =>
        (p.cliente?.nombre ?? "").toLowerCase().includes(q) ||
        (p.num_guia ?? "").toLowerCase().includes(q) ||
        (p.paqueteria ?? "").toLowerCase().includes(q) ||
        (p.referencia_externa ?? "").toLowerCase().includes(q) ||
        nombreVenta(p).toLowerCase().includes(q),
    );
  }, [pedidos, conHistorico, filtro, filtroCanal, busqueda]);

  function cambiar(id: string, estado: EstadoPedidoId) {
    startTransition(async () => {
      try {
        const r = await cambiarEstadoPedido(id, estado);
        if ("error" in r) toast.error(r.error);
      } catch {
        toast.error("No se pudo actualizar el pedido. Revisa tu conexión.");
      }
    });
  }

  const columnas: Columna<PedidoEnvio>[] = [
    {
      clave: "fecha",
      label: "Fecha",
      celda: (p) => {
        const atrasado = esPedidoAtrasado(p.fecha, p.estado);
        const plazo = plazoUrgente(p, ahora);
        return (
          <div className="min-w-0">
            <span
              className={cn("inline-flex items-center gap-1", atrasado && "font-semibold text-red-600")}
            >
              {atrasado && <AlertTriangle className="size-3.5" aria-label="Atrasado" />}
              {formatearFecha(p.fecha)}
            </span>
            {/* Semáforo del plazo de despacho de ML: es el dato por el que se
                decide qué empacar primero, y vivía solo en el panel del canal. */}
            {plazo && (
              <span
                className="block"
                title={`Plazo de despacho de Mercado Libre: ${formatearFechaHora(p.envio_limite_despacho!)}`}
              >
                <Pastilla
                  nombre={SITUACION[plazo].nombre}
                  color={SITUACION[plazo].color}
                  className="mt-1 whitespace-nowrap px-1.5 py-0.5 text-[10.5px]"
                />
              </span>
            )}
          </div>
        );
      },
    },
    {
      clave: "producto",
      label: "Producto",
      esTitulo: true,
      celda: (p) => (
        <div className="min-w-0">
          <div className="truncate font-medium" title={nombreVenta(p)}>
            {nombreVenta(p)}
            {p.cantidad > 1 && <span className="ml-1 text-muted-foreground">×{p.cantidad}</span>}
          </div>
          {/* Nº de orden del canal: es el dato por el que pregunta el cliente, y
              el enlace lleva a esa misma orden en el panel de la plataforma
              (conversación con el comprador, factura, reclamos: lo que el CRM no
              replica). */}
          {p.referencia_externa &&
            (() => {
              const ref = numeroOrden(p.referencia_externa);
              const url = urlOrdenCanal(p.canal, ref, dominioTiendaNube, p.url_orden);
              const texto = `#${ref}`;
              return url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Abrir la orden en ${obtenerCanal(p.canal)?.nombre ?? "la plataforma"}`}
                  className="inline-flex max-w-full items-center gap-1 font-mono text-[11.5px] text-muted-foreground hover:text-foreground hover:underline"
                >
                  <span className="truncate">{texto}</span>
                  <ExternalLink className="size-3 shrink-0" />
                </a>
              ) : (
                <div className="truncate font-mono text-[11.5px] text-muted-foreground">{texto}</div>
              );
            })()}
        </div>
      ),
    },
    {
      clave: "cliente",
      label: "Cliente",
      celda: (p) => (
        <div className="truncate text-muted-foreground" title={p.cliente?.nombre ?? ""}>
          {p.cliente?.nombre ?? "—"}
        </div>
      ),
    },
    {
      clave: "canal",
      label: "Canal",
      celda: (p) => {
        const canal = obtenerCanal(p.canal);
        return canal ? <Pastilla nombre={canal.nombre} color={canal.color} /> : null;
      },
    },
    {
      clave: "estado",
      label: "Estado",
      celda: (p) => (
        <Select
          value={p.estado ?? undefined}
          onValueChange={(v) => v && cambiar(p.id, v as EstadoPedidoId)}
        >
          <SelectTrigger className="h-auto w-fit gap-1 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0">
            {p.estado && <PastillaEstado estado={p.estado} />}
          </SelectTrigger>
          <SelectContent>
            {ESTADOS_PEDIDO.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
    {
      clave: "envio",
      label: "Envío",
      cardAncho: true,
      celda: (p) => {
        const rastreo = urlRastreo(p.paqueteria, p.num_guia, p.url_rastreo);
        const etiqueta = urlEtiquetaDirecta(p);
        const pendiente = p.estado === "nuevo" || p.estado === "preparando";
        const verPedido = pendiente ? urlVerPedido(p, dominioTiendaNube) : null;
        const nombreCanal = obtenerCanal(p.canal)?.nombre ?? "la plataforma";
        return (
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setEnvio(p)}
              className="min-w-0 flex-1 text-left text-xs text-muted-foreground hover:text-foreground"
              title={
                p.num_guia
                  ? `${p.paqueteria ?? "Guía"} ${p.num_guia}`
                  : "Ver/editar paquetería y guía"
              }
            >
              {p.num_guia ? (
                /* Paquetería arriba y guía abajo: en una sola línea no cabían y
                   la guía —lo que uno copia— era justo lo que se cortaba. */
                <span className="flex min-w-0 items-center gap-1">
                  <Truck className="size-3.5 shrink-0" />
                  <span className="min-w-0 leading-tight">
                    {p.paqueteria && <span className="block truncate">{p.paqueteria}</span>}
                    <span className="block truncate font-mono hover:underline">{p.num_guia}</span>
                  </span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-primary hover:underline">
                  <Truck className="size-3.5 shrink-0" />
                  Agregar guía
                </span>
              )}
            </button>
            {/* Dos acciones separadas mientras el pedido está por empacar:
                la impresora SOLO cuando el clic entrega la etiqueta de verdad
                (ML con id de envío), y "ver pedido" para abrir la orden en el
                panel del canal — que es donde se imprime cuando no hay PDF. */}
            {etiqueta && (
              <a
                href={etiqueta}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title="Imprimir la guía (PDF directo de Mercado Libre)"
                aria-label="Imprimir la guía"
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Printer className="size-3.5" />
              </a>
            )}
            {verPedido && (
              <a
                href={verPedido}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={
                  etiqueta
                    ? `Ver el pedido en ${nombreCanal}`
                    : `Ver el pedido en ${nombreCanal} (ahí se imprime la guía)`
                }
                aria-label={`Ver el pedido en ${nombreCanal}`}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Eye className="size-3.5" />
              </a>
            )}
            {/* Atajo al rastreo de la paquetería: evita copiar la guía a mano en
                el sitio del transportista para saber dónde va el paquete. */}
            {rastreo && (
              <a
                href={rastreo}
                target="_blank"
                rel="noopener noreferrer"
                title={`Rastrear en ${p.paqueteria}`}
                aria-label={`Rastrear el envío en ${p.paqueteria}`}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      {/* Encabezado */}
      <div className="mb-5 flex flex-col gap-4 md:flex-row md:flex-wrap md:items-start md:justify-between">
        <div>
          <h1 className="text-[26px] font-bold tracking-[-0.5px]">Pedidos y envíos</h1>
          <p className="mt-1.5 text-[14.5px] text-muted-foreground">
            Qué hay que preparar y mandar, y qué se está atrasando. Los de Tienda Nube entran solos.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
          <div className="relative flex min-w-[220px] flex-1 items-center md:flex-none">
            <Search
              className="pointer-events-none absolute left-3 size-4 text-muted-foreground"
              strokeWidth={1.9}
            />
            <Input
              placeholder="Cliente, guía o nº de orden…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="h-auto rounded-[10px] bg-card py-2 pl-9"
            />
          </div>

          <Select
            value={filtroCanal}
            onValueChange={(v) => setFiltroCanal((v ?? "todos") as CanalId | "todos")}
          >
            <SelectTrigger className="w-full bg-card md:w-[185px]">
              <SelectValue>
                {(v: string) =>
                  v === "todos" ? "Todos los canales" : (obtenerCanal(v)?.nombre ?? "Canal")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los canales</SelectItem>
              {CANALES.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex w-full rounded-xl bg-muted p-[3px] md:w-auto">
            {FILTROS.map(([id, label]) => (
              <button
                key={id}
                onClick={() => {
                  setFiltro(id);
                  /* El histórico se pide la primera vez que hace falta. */
                  if (id !== "pendientes") void asegurarHistorico();
                }}
                className={cn(
                  "flex-1 rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-colors md:flex-none",
                  filtro === id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <StatCard etiqueta="Nuevos" valor={String(conteo.nuevos)} icono={Clock} />
        <StatCard etiqueta="Preparando" valor={String(conteo.preparando)} icono={PackageCheck} />
        <StatCard etiqueta="Enviados" valor={String(conteo.enviados)} icono={Send} />
        <StatCard
          etiqueta="Atrasados"
          valor={String(conteo.atrasados)}
          icono={AlertTriangle}
          valorClassName={conteo.atrasados > 0 ? "text-red-600" : undefined}
        />
      </div>

      <TablaSimple
        cols={COLS}
        columnas={columnas}
        datos={visibles}
        filaKey={(p) => p.id}
        minW="min-w-[900px]"
        onRowClick={(p) => setEnvio(p)}
        filaClassName={(p) =>
          esPedidoAtrasado(p.fecha, p.estado) || plazoUrgente(p, ahora) === "vencido"
            ? "bg-red-50/50 dark:bg-red-950/20"
            : ""
        }
        vacio={
          filtro === "pendientes"
            ? "No hay pedidos pendientes. Todo al día. 🎉"
            : cargandoHistorico
              ? "Cargando el histórico…"
              : "No hay pedidos que mostrar."
        }
      />

      {envio && (
        <EnvioDialog
          pedido={envio}
          gestor={gestor}
          onClose={() => setEnvio(null)}
        />
      )}
    </div>
  );
}
