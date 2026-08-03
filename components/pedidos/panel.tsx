"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, Clock, PackageCheck, Send, Truck } from "lucide-react";
import { toast } from "sonner";
import { ESTADOS_PEDIDO, esGestor, obtenerCanal, obtenerEstadoPedido } from "@/lib/catalogos";
import { esPedidoAtrasado, formatearFecha } from "@/lib/fecha";
import { nombreVenta } from "@/lib/ventas";
import { cambiarEstadoPedido } from "@/app/(app)/pedidos/actions";
import type { EstadoPedidoId, RolId, SaleConDetalle } from "@/lib/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
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

const COLS = "grid-cols-[95px_minmax(160px,1fr)_140px_130px_150px_60px]";

function PastillaEstado({ estado }: { estado: string }) {
  const e = obtenerEstadoPedido(estado);
  if (!e) return null;
  return <Pastilla nombre={e.nombre} color={e.color} />;
}

export function PanelPedidos({ pedidos, rol }: { pedidos: SaleConDetalle[]; rol: RolId }) {
  const gestor = esGestor(rol);
  const [filtro, setFiltro] = useState<Filtro>("pendientes");
  const [envio, setEnvio] = useState<SaleConDetalle | null>(null);
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
    if (filtro === "entregado") return pedidos.filter((p) => p.estado === "entregado");
    if (filtro === "todos") return pedidos;
    // pendientes: nuevo, preparando, enviado (lo que aún da trabajo)
    return pedidos.filter(
      (p) => p.estado === "nuevo" || p.estado === "preparando" || p.estado === "enviado",
    );
  }, [pedidos, filtro]);

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

  const columnas: Columna<SaleConDetalle>[] = [
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
        <span className="truncate font-medium" title={nombreVenta(p)}>
          {nombreVenta(p)}
          {p.cantidad > 1 && <span className="ml-1 text-muted-foreground">×{p.cantidad}</span>}
        </span>
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
      cardValorClassName: "flex justify-end",
      celda: (p) => (
        <Select
          value={p.estado ?? undefined}
          onValueChange={(v) => v && cambiar(p.id, v as EstadoPedidoId)}
        >
          <SelectTrigger className="ml-auto h-auto w-fit gap-1 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 md:ml-0">
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
      celda: (p) => (
        <button
          type="button"
          onClick={() => setEnvio(p)}
          className="text-left text-xs text-muted-foreground hover:text-foreground hover:underline"
          title="Ver/editar paquetería y guía"
        >
          {p.num_guia ? (
            <span className="inline-flex items-center gap-1">
              <Truck className="size-3.5" />
              {p.paqueteria ? `${p.paqueteria} ` : ""}
              {p.num_guia}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-primary">
              <Truck className="size-3.5" />
              Agregar guía
            </span>
          )}
        </button>
      ),
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
        minW="min-w-[820px]"
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
