"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, Clock, ExternalLink, PackageCheck, Search, Send, Truck } from "lucide-react";
import { toast } from "sonner";
import { CANALES, ESTADOS_PEDIDO, esGestor, obtenerCanal, obtenerEstadoPedido } from "@/lib/catalogos";
import { esPedidoAtrasado, formatearFecha } from "@/lib/fecha";
import { nombreVenta } from "@/lib/ventas";
import { urlOrdenCanal, urlRastreo } from "@/lib/pedidos/rastreo";
import { cambiarEstadoPedido } from "@/app/(app)/pedidos/actions";
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
   corresponde a la información con la que uno trabaja al empacar. */
const COLS = "grid-cols-[88px_minmax(170px,1fr)_130px_120px_118px_minmax(215px,250px)]";

/* `referencia_externa` es por RENGLÓN ("<orden>:<línea>"); lo que identifica al
   pedido de cara al cliente es la parte de la orden. */
function numeroOrden(ref: string): string {
  return ref.split(":")[0];
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
}: {
  pedidos: PedidoEnvio[];
  rol: RolId;
  /* Subdominio del panel de la tienda; sin él no se puede enlazar la orden de
     Tienda Nube (cada tienda tiene el suyo). Ver app/(app)/pedidos/page.tsx. */
  dominioTiendaNube?: string | null;
}) {
  const gestor = esGestor(rol);
  const [filtro, setFiltro] = useState<Filtro>("pendientes");
  const [filtroCanal, setFiltroCanal] = useState<CanalId | "todos">("todos");
  const [busqueda, setBusqueda] = useState("");
  const [envio, setEnvio] = useState<PedidoEnvio | null>(null);
  const [, startTransition] = useTransition();

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
        ? pedidos.filter((p) => p.estado === "entregado")
        : filtro === "todos"
          ? pedidos
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
  }, [pedidos, filtro, filtroCanal, busqueda]);

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
        return (
          <span
            className={cn("inline-flex items-center gap-1", atrasado && "font-semibold text-red-600")}
          >
            {atrasado && <AlertTriangle className="size-3.5" aria-label="Atrasado" />}
            {formatearFecha(p.fecha)}
          </span>
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
                onClick={() => setFiltro(id)}
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
        filaClassName={(p) => (esPedidoAtrasado(p.fecha, p.estado) ? "bg-red-50/50 dark:bg-red-950/20" : "")}
        vacio={
          filtro === "pendientes"
            ? "No hay pedidos pendientes. Todo al día. 🎉"
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
