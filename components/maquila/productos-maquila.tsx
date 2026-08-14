"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Miniatura } from "@/components/compartido/miniatura";
import { Pastilla } from "@/components/compartido/pastilla";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { SelectorProducto, type ProductoElegible } from "@/components/compartido/selector-producto";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { cambiarFichaMaquilaActiva, marcarFichaMaquila } from "@/app/(app)/maquila/actions";
import {
  ACABADOS_MAQUILA,
  COMBOS_MAQUILA,
  MODELOS_MAQUILA,
  obtenerAcabadoMaquila,
  obtenerComboMaquila,
  obtenerModeloMaquila,
} from "@/lib/catalogos";
import type {
  AcabadoMaquilaId,
  ComboMaquilaId,
  MaquilaProductoConFicha,
  ModeloMaquilaId,
} from "@/lib/types";

/* Qué fichas del catálogo produce Eduardo, y cómo. SIN esto la ingesta no
   detecta nada: marcar un producto aquí es lo que manda sus ventas de Tienda
   Nube al tablero. Solo administración marca (decide qué se fabrica). */
export function ProductosMaquila({
  fichas,
  productos,
  esAdmin,
}: {
  fichas: MaquilaProductoConFicha[];
  productos: ProductoElegible[];
  esAdmin: boolean;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [sku, setSku] = useState("");
  const [productoId, setProductoId] = useState<string | null>(null);
  const [modelo, setModelo] = useState<ModeloMaquilaId>("powerlift");
  const [acabado, setAcabado] = useState<AcabadoMaquilaId>("prensado");
  const [combo, setCombo] = useState<ComboMaquilaId>("ninguno");

  const columnas: Columna<MaquilaProductoConFicha>[] = [
    {
      clave: "producto",
      label: "Producto",
      esTitulo: true,
      celda: (f) => (
        <div className="flex min-w-0 items-center gap-3">
          {/* La foto que pidió Armando: con puro texto, dos cintos de la misma
              línea solo se distinguen por el SKU. */}
          <Miniatura
            src={f.producto?.imagen_url ?? null}
            alt={f.producto?.nombre ?? "Producto"}
            tam="size-12"
          />
          <div className="min-w-0">
            <div className="truncate font-semibold">{f.producto?.nombre ?? f.producto_id}</div>
            <div className="truncate text-[12px] text-muted-foreground">
              {[f.producto?.sku, f.producto?.variante].filter(Boolean).join(" · ") || "—"}
            </div>
          </div>
        </div>
      ),
    },
    {
      clave: "modelo",
      label: "Modelo",
      celda: (f) => <span>{obtenerModeloMaquila(f.modelo)?.nombre ?? f.modelo}</span>,
    },
    {
      clave: "acabado",
      label: "Acabado",
      celda: (f) => {
        const a = obtenerAcabadoMaquila(f.acabado);
        return a ? <Pastilla nombre={a.nombre} color={a.color} /> : <span>{f.acabado}</span>;
      },
    },
    {
      clave: "combo",
      label: "Combo por defecto",
      celda: (f) => (
        <span className="text-muted-foreground">
          {obtenerComboMaquila(f.combo)?.nombre ?? f.combo}
        </span>
      ),
    },
    {
      clave: "activo",
      label: "Estado",
      celda: (f) =>
        esAdmin ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              ejecutar(() => cambiarFichaMaquilaActiva(f.producto_id, !f.activo), {
                ok: f.activo ? "Ficha pausada: sus ventas ya no van a maquila." : "Ficha activa.",
              })
            }
          >
            {f.activo ? "Pausar" : "Reactivar"}
          </Button>
        ) : (
          <Pastilla
            nombre={f.activo ? "Activa" : "Pausada"}
            color={f.activo ? "#22c55e" : "#94a3b8"}
          />
        ),
    },
  ];

  return (
    <div className="grid gap-4">
      {esAdmin && (
        <div className="grid gap-3 rounded-2xl border bg-card p-4">
          <div className="text-[13px] font-semibold">
            Marcar una ficha del catálogo como “de maquila”
          </div>
          <p className="-mt-1 text-[12.5px] text-muted-foreground">
            Desde que se marca, cada venta de esa ficha en Tienda Nube cae sola al tablero de
            Eduardo. La talla y el color salen de la variante; aquí se define lo que la variante no
            dice: modelo y acabado.
          </p>
          <div className="grid gap-3 md:grid-cols-[minmax(220px,1.4fr)_1fr_1fr_1fr_auto]">
            <div className="grid gap-1.5">
              <Label>Producto</Label>
              <SelectorProducto
                valor={sku}
                productoId={productoId}
                productos={productos}
                onCambio={(v, id) => {
                  setSku(v);
                  setProductoId(id);
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Modelo</Label>
              <Select value={modelo} onValueChange={(v) => v && setModelo(v as ModeloMaquilaId)}>
                <SelectTrigger>
                  <SelectValue>{(v: string) => obtenerModeloMaquila(v)?.nombre ?? v}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {MODELOS_MAQUILA.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Acabado</Label>
              <Select value={acabado} onValueChange={(v) => v && setAcabado(v as AcabadoMaquilaId)}>
                <SelectTrigger>
                  <SelectValue>{(v: string) => obtenerAcabadoMaquila(v)?.nombre ?? v}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ACABADOS_MAQUILA.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Combo</Label>
              <Select value={combo} onValueChange={(v) => v && setCombo(v as ComboMaquilaId)}>
                <SelectTrigger>
                  <SelectValue>{(v: string) => obtenerComboMaquila(v)?.nombre ?? v}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {COMBOS_MAQUILA.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                disabled={pending || !productoId}
                onClick={() =>
                  productoId &&
                  ejecutar(() => marcarFichaMaquila(productoId, modelo, acabado, combo), {
                    ok: "Ficha marcada: sus ventas nuevas ya van a maquila.",
                    alExito: () => {
                      setSku("");
                      setProductoId(null);
                    },
                  })
                }
              >
                Marcar
              </Button>
            </div>
          </div>
        </div>
      )}

      <TablaSimple
        cols="grid-cols-[minmax(220px,1.5fr)_120px_150px_170px_130px]"
        columnas={columnas}
        datos={fichas}
        filaKey={(f) => f.producto_id}
        minW="min-w-[860px]"
        vacio="Ninguna ficha marcada todavía. Sin fichas, ninguna venta cae al tablero de Eduardo."
      />
    </div>
  );
}
