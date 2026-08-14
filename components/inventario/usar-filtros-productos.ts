"use client";

/* El estado de búsqueda y los cuatro filtros del catálogo. Salió de panel.tsx,
   que eran 827 líneas: el hook y sus dos catálogos de opciones son una pieza
   con vida propia —los usa la barra de filtros y la tabla que explica por qué
   salió vacía—, y el panel no tiene por qué llevarlos dentro.

   Vive en components/inventario/ y no en compartido/ porque solo lo usa esta
   pantalla; sigue la convención de nombre de usar-ajuste-stock.ts. */

import { useMemo, useState } from "react";
import { estadoStock, obtenerEstadoStock } from "@/lib/inventario/stock";
import { obtenerTipoProducto } from "@/lib/catalogos";
import { esDepositoFull, esTikTokDelegado, tieneFull } from "@/lib/inventario/reabastecimiento";
import type { ProductConProveedor } from "@/lib/types";

/* Filtro de dónde está guardado el stock: Mercado Full y el inventario delegado
   a TikTok son almacenes distintos al de la bodega. */
export const LOGISTICAS = [
  ["todos", "Todos los almacenes"],
  ["bodega", "Solo bodega"],
  ["full", "Solo Mercado Full"],
  ["tiktok", "Solo TikTok (delegado)"],
] as const;

/* Filtro de ciclo de vida: por defecto se ocultan los descontinuados para no
   ensuciar el catálogo vigente (siguen consultables eligiendo su opción). */
export const VIGENCIAS = [
  ["vigentes", "Vigentes"],
  ["descontinuados", "Descontinuados"],
  ["todos", "Todos"],
] as const;

/* Dónde busca el buscador. Escribir «MO-BA» tiene que encontrar el SKU igual que
   escribir «mochila» encuentra el nombre, y «Textiles del Norte» todo lo que
   surte ese proveedor: quien busca no sabe —ni tiene por qué— por cuál de los
   cuatro campos va a pegar. */
function coincide(p: ProductConProveedor, q: string) {
  return (
    p.nombre.toLowerCase().includes(q) ||
    (p.sku ?? "").toLowerCase().includes(q) ||
    (p.variante ?? "").toLowerCase().includes(q) ||
    (p.proveedor?.nombre ?? "").toLowerCase().includes(q)
  );
}

/* Una categoría de la tienda, espejada por la sync (tabla tn_categorias). */
export type CategoriaTNFila = { id: number; nombre: string; parent_id: number | null };

/* Búsqueda + los filtros del catálogo, con la lista filtrada y el resumen de
   filtros activos que la tabla usa para explicar por qué salió vacía.

   `categoriasTN`/`categoriasPorProducto` (opcionales) encienden el filtro por
   categoría de Tienda Nube (junta 13/08): elegir «Cinturones» incluye sus
   subcategorías, igual que en la tienda. */
export function useFiltrosProductos(
  productos: ProductConProveedor[],
  opciones?: {
    categoriasTN?: CategoriaTNFila[];
    categoriasPorProducto?: Record<string, number[]>;
  },
) {
  const categoriasTN = opciones?.categoriasTN;
  const categoriasPorProducto = opciones?.categoriasPorProducto;
  /* Búsqueda y filtro de tipo — aplican a "Productos" y a "Qué pedir". */
  const [busqueda, setBusqueda] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("todos");
  /* Filtro de semáforo de stock (solo aplica a la pestaña de productos). */
  const [filtroStock, setFiltroStock] = useState("todos");
  /* Filtro de almacén: bodega / Mercado Full / TikTok delegado. */
  const [filtroLogistica, setFiltroLogistica] = useState("todos");
  /* Filtro de ciclo de vida: por defecto solo los vigentes. */
  const [filtroVigencia, setFiltroVigencia] = useState("vigentes");
  /* Categoría de Tienda Nube: "todas" | "sin" | el id (en texto, para el Select). */
  const [filtroCategoriaTN, setFiltroCategoriaTN] = useState("todas");

  /* La categoría elegida MÁS sus descendientes: en la tienda, «Cinturones»
     envuelve a Powerlift, Pro y Liquidación, y aquí debe filtrar igual. */
  const categoriasAceptadas = useMemo(() => {
    if (filtroCategoriaTN === "todas" || filtroCategoriaTN === "sin" || !categoriasTN) return null;
    const hijos = new Map<number, number[]>();
    for (const c of categoriasTN) {
      if (c.parent_id == null) continue;
      const lista = hijos.get(c.parent_id);
      if (lista) lista.push(c.id);
      else hijos.set(c.parent_id, [c.id]);
    }
    const set = new Set<number>();
    const pila = [Number(filtroCategoriaTN)];
    while (pila.length) {
      const id = pila.pop()!;
      if (set.has(id)) continue;
      set.add(id);
      pila.push(...(hijos.get(id) ?? []));
    }
    return set;
  }, [filtroCategoriaTN, categoriasTN]);

  /* Los CINCO recortes se aplican aquí, no en la tabla. Antes el hook solo hacía
     almacén y vigencia, y búsqueda/tipo/stock estaban copiados igual en la tabla
     desglosada y en la agrupada: dos sitios que podían separarse, y —lo que
     importa ahora— nadie fuera de la tabla sabía cuántos productos quedaban.
     El buscador enseña ese número mientras escribes, así que el recuento tiene
     que vivir donde lo ven los dos. */
  const q = busqueda.trim().toLowerCase();
  const productosVisibles = useMemo(
    () =>
      productos.filter((p) => {
        /* «Bodega» deja fuera lo que no está en ella: el depósito que gobierna
           Mercado Full y el inventario delegado a TikTok. Un producto que está
           en los dos sitios (bodega + Full) sale en ambos filtros, que es lo
           correcto: tiene existencias en ambos almacenes. */
        if (filtroLogistica === "bodega" && (esDepositoFull(p) || esTikTokDelegado(p))) return false;
        if (filtroLogistica === "full" && !tieneFull(p)) return false;
        if (filtroLogistica === "tiktok" && !esTikTokDelegado(p)) return false;
        if (filtroVigencia === "vigentes" && p.descontinuado) return false;
        if (filtroVigencia === "descontinuados" && !p.descontinuado) return false;
        if (filtroTipo !== "todos" && p.tipo !== filtroTipo) return false;
        if (filtroStock !== "todos" && estadoStock(p) !== filtroStock) return false;
        /* Categoría de la tienda: «sin» = lo que TN no tiene categorizado (o no
           está en TN); una categoría concreta incluye sus subcategorías. */
        if (filtroCategoriaTN === "sin" && (categoriasPorProducto?.[p.id]?.length ?? 0) > 0)
          return false;
        if (
          categoriasAceptadas &&
          !(categoriasPorProducto?.[p.id] ?? []).some((id) => categoriasAceptadas.has(id))
        )
          return false;
        if (q && !coincide(p, q)) return false;
        return true;
      }),
    [
      productos,
      filtroLogistica,
      filtroVigencia,
      filtroTipo,
      filtroStock,
      filtroCategoriaTN,
      categoriasAceptadas,
      categoriasPorProducto,
      q,
    ],
  );

  /* Los filtros se acumulan, así que una combinación inocente («Solo Mercado
     Full» + «Descontinuados») puede no dejar pasar nada. Para que la tabla pueda
     decir POR QUÉ salió vacía, se le pasan los que están puestos con su nombre
     legible. «Vigentes» cuenta como filtro activo aunque sea el default: es el
     que esconde los descontinuados, y no saberlo es justo la trampa. */
  const filtrosActivos = [
    busqueda.trim() && `Búsqueda: «${busqueda.trim()}»`,
    filtroTipo !== "todos" && `Tipo: ${obtenerTipoProducto(filtroTipo)?.nombre ?? filtroTipo}`,
    filtroStock !== "todos" && `Stock: ${obtenerEstadoStock(filtroStock)?.nombre ?? filtroStock}`,
    filtroLogistica !== "todos" &&
      `Almacén: ${LOGISTICAS.find(([id]) => id === filtroLogistica)?.[1] ?? filtroLogistica}`,
    filtroVigencia !== "todos" &&
      `Vigencia: ${VIGENCIAS.find(([id]) => id === filtroVigencia)?.[1] ?? filtroVigencia}`,
    filtroCategoriaTN !== "todas" &&
      `Categoría TN: ${
        filtroCategoriaTN === "sin"
          ? "Sin categoría"
          : (categoriasTN?.find((c) => String(c.id) === filtroCategoriaTN)?.nombre ?? filtroCategoriaTN)
      }`,
  ].filter(Boolean) as string[];

  /* Deja ver TODO el catálogo: incluye la vigencia, que si no seguiría
     escondiendo los descontinuados después de «limpiar». */
  function limpiarFiltros() {
    setBusqueda("");
    setFiltroTipo("todos");
    setFiltroStock("todos");
    setFiltroLogistica("todos");
    setFiltroVigencia("todos");
    setFiltroCategoriaTN("todas");
  }

  return {
    busqueda,
    setBusqueda,
    filtroTipo,
    setFiltroTipo,
    filtroStock,
    setFiltroStock,
    filtroLogistica,
    setFiltroLogistica,
    filtroVigencia,
    setFiltroVigencia,
    filtroCategoriaTN,
    setFiltroCategoriaTN,
    productosVisibles,
    filtrosActivos,
    limpiarFiltros,
  };
}
