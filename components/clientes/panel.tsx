"use client";

import { useMemo, useState } from "react";
import { Plus, Repeat, Search, UserPlus, Users } from "lucide-react";
import { esGestor, obtenerCanal } from "@/lib/catalogos";
import { formatearFecha } from "@/lib/fecha";
import { formatearMXN } from "@/lib/moneda";
import type { CustomerConStats, RolId, SaleConProducto } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatCard } from "@/components/compartido/stat-card";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { ClienteDialog } from "@/components/clientes/cliente-dialog";
import { ClienteDetalle } from "@/components/clientes/cliente-detalle";
import { cn } from "@/lib/utils";

type Orden = "total" | "compras" | "reciente" | "nombre";

const ORDENES: [Orden, string][] = [
  ["total", "Más gastan"],
  ["compras", "Más compran"],
  ["reciente", "Más recientes"],
  ["nombre", "Nombre"],
];

const COLS = "grid-cols-[minmax(180px,1fr)_140px_130px_90px_120px_110px]";

export function PanelClientes({
  clientes,
  ventas,
  rol,
}: {
  clientes: CustomerConStats[];
  ventas: SaleConProducto[];
  rol: RolId;
}) {
  const gestor = esGestor(rol);
  const [busqueda, setBusqueda] = useState("");
  const [orden, setOrden] = useState<Orden>("total");
  const [editar, setEditar] = useState<CustomerConStats | "nuevo" | null>(null);
  const [detalle, setDetalle] = useState<CustomerConStats | null>(null);

  const recurrentes = clientes.filter((c) => c.recurrente).length;
  const conCompras = clientes.filter((c) => c.compras > 0).length;
  const nuevos = conCompras - recurrentes;
  const totalVendido = clientes.reduce((a, c) => a + c.total, 0);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const filtrados = q
      ? clientes.filter(
          (c) =>
            c.nombre.toLowerCase().includes(q) ||
            (c.correo ?? "").toLowerCase().includes(q) ||
            (c.telefono ?? "").toLowerCase().includes(q),
        )
      : clientes;
    const copia = [...filtrados];
    copia.sort((a, b) => {
      if (orden === "total") return b.total - a.total;
      if (orden === "compras") return b.compras - a.compras;
      if (orden === "reciente") return (b.ultimaCompra ?? "").localeCompare(a.ultimaCompra ?? "");
      return a.nombre.localeCompare(b.nombre, "es");
    });
    return copia;
  }, [clientes, busqueda, orden]);

  /* Historial del cliente abierto (todas sus ventas, de la más reciente). */
  const historial = useMemo(
    () => (detalle ? ventas.filter((v) => v.cliente_id === detalle.id) : []),
    [detalle, ventas],
  );

  const columnas: Columna<CustomerConStats>[] = [
    {
      clave: "cliente",
      label: "Cliente",
      esTitulo: true,
      celda: (c) => (
        <button
          type="button"
          onClick={() => setDetalle(c)}
          className="flex items-center gap-2 truncate text-left font-medium hover:underline"
          title={c.notas ?? c.nombre}
        >
          <span className="truncate">{c.nombre}</span>
          {c.recurrente && (
            <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10.5px] font-bold text-primary">
              Recurrente
            </span>
          )}
        </button>
      ),
    },
    {
      clave: "contacto",
      label: "Contacto",
      celda: (c) => (
        <div className="truncate text-muted-foreground" title={c.correo ?? c.telefono ?? ""}>
          {c.correo ?? c.telefono ?? "—"}
        </div>
      ),
    },
    {
      clave: "canal",
      label: "Canal",
      celda: (c) => {
        const canal = obtenerCanal(c.canal ?? "");
        return canal ? (
          <span
            className="inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold"
            style={{ backgroundColor: `${canal.color}1F`, color: canal.color }}
          >
            {canal.nombre}
          </span>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        );
      },
    },
    { clave: "compras", label: "Compras", celda: (c) => <div className="tabular-nums">{c.compras}</div> },
    {
      clave: "total",
      label: "Total gastado",
      celda: (c) => <div className="font-semibold tabular-nums">{formatearMXN(c.total)}</div>,
    },
    {
      clave: "ultima",
      label: "Última compra",
      celda: (c) => (
        <div className="text-muted-foreground">
          {c.ultimaCompra ? formatearFecha(c.ultimaCompra) : "—"}
        </div>
      ),
    },
  ];

  return (
    <div>
      {/* Encabezado */}
      <div className="mb-5 flex flex-col gap-4 md:flex-row md:flex-wrap md:items-start md:justify-between">
        <div>
          <h1 className="text-[26px] font-bold tracking-[-0.5px]">Clientes y ventas</h1>
          <p className="mt-1.5 text-[14.5px] text-muted-foreground">
            Quién compra, por dónde y cuánto. Los de Tienda Nube entran solos con cada pedido.
          </p>
        </div>
        <Button
          onClick={() => setEditar("nuevo")}
          className="h-10 w-full rounded-xl text-[13.5px] font-semibold shadow-[0_6px_16px_-8px_var(--primary)] md:w-auto"
        >
          <Plus className="size-4" strokeWidth={2.1} />
          Nuevo cliente
        </Button>
      </div>

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-2 gap-3.5 md:grid-cols-4">
        <StatCard etiqueta="Clientes" valor={String(clientes.length)} icono={Users} />
        <StatCard etiqueta="Recurrentes" valor={String(recurrentes)} icono={Repeat} />
        <StatCard etiqueta="Compraron una vez" valor={String(Math.max(0, nuevos))} icono={UserPlus} />
        <StatCard etiqueta="Total vendido" valor={formatearMXN(totalVendido)} />
      </div>

      {/* Búsqueda + orden */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex min-w-[280px] flex-1 items-center sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" strokeWidth={1.9} />
          <Input
            placeholder="Buscar por nombre, correo o teléfono…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="h-auto rounded-[10px] bg-card py-2 pl-9"
          />
        </div>
        <div className="hidden flex-1 md:block" />
        {/* Móvil: Select. Escritorio: segmentado. */}
        <Select value={orden} onValueChange={(v) => v && setOrden(v as Orden)}>
          <SelectTrigger className="w-full bg-card md:hidden">
            <SelectValue>
              {(v: string) => {
                const label = ORDENES.find(([id]) => id === v)?.[1] ?? "Ordenar";
                return `Orden: ${label}`;
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {ORDENES.map(([id, label]) => (
              <SelectItem key={id} value={id}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="hidden rounded-xl bg-muted p-[3px] md:inline-flex">
          {ORDENES.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setOrden(id)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors",
                orden === id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {visibles.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">
          {clientes.length === 0
            ? "Aún no hay clientes. Los de Tienda Nube aparecerán al importar ventas; los de mostrador se dan de alta con «Nuevo cliente»."
            : "Ningún cliente coincide con la búsqueda."}
        </p>
      ) : (
        <TablaSimple
          cols={COLS}
          columnas={columnas}
          datos={visibles}
          filaKey={(c) => c.id}
          minW="min-w-[880px]"
        />
      )}

      {editar && (
        <ClienteDialog
          cliente={editar === "nuevo" ? null : editar}
          gestor={gestor}
          onClose={() => setEditar(null)}
        />
      )}

      {detalle && (
        <ClienteDetalle
          cliente={detalle}
          historial={historial}
          onEditar={() => {
            const c = detalle;
            setDetalle(null);
            setEditar(c);
          }}
          onClose={() => setDetalle(null)}
        />
      )}
    </div>
  );
}
