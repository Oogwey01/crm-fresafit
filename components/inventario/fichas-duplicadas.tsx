"use client";

import { useState } from "react";
import { Merge } from "lucide-react";
import type { GrupoDuplicado } from "@/lib/inventario/duplicados-ml";
import { fusionarProductosML } from "@/app/(app)/inventario/actions";
import { Button } from "@/components/ui/button";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { cn } from "@/lib/utils";

/* ============================================================================
   Fichas que son el mismo artículo
   ----------------------------------------------------------------------------
   Dos caminos llevan aquí: una publicación gemela de ML que comparte bodega con
   la original, o una publicación suelta que terminó con el mismo SKU que la
   ficha de Tienda Nube. En ambos se listan y se unen de a una, viendo antes qué
   se queda y qué se mueve.
   ============================================================================ */

function Ficha({
  ficha,
  esGanador,
  children,
}: {
  ficha: GrupoDuplicado["fichas"][number];
  esGanador: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-lg border px-3 py-2.5 md:flex-row md:items-center md:justify-between",
        esGanador ? "border-green-600/40 bg-green-600/5" : "bg-muted/30",
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-[13.5px] font-medium" title={ficha.nombre}>
          {ficha.nombre}
          {!ficha.activo && <span className="ml-1.5 text-xs text-muted-foreground">(inactiva)</span>}
        </p>
        <p className="text-xs text-muted-foreground">
          {ficha.meli_item_id} · SKU {ficha.sku ?? "—"} · stock {ficha.stock} · {ficha.ventas} venta
          {ficha.ventas === 1 ? "" : "s"}
          {ficha.en_tiendanube && " · en Tienda Nube"}
        </p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function FichasDuplicadas({
  grupos,
  onFusionado,
}: {
  grupos: GrupoDuplicado[];
  onFusionado: (clave: string) => void;
}) {
  const { pending: pendiente, ejecutar } = useAccionServidor();
  const [trabajando, setTrabajando] = useState<string | null>(null);

  function unir(grupo: GrupoDuplicado, ganadorId: string) {
    const perdedores = grupo.fichas.filter((f) => f.id !== ganadorId);
    const movidas = perdedores.reduce((s, f) => s + f.ventas, 0);
    setTrabajando(grupo.clave);
    /* Las fichas perdedoras se funden de una en una y se corta al primer error:
       lo que ya se unió se queda unido, y el mensaje dice cuál falló. */
    ejecutar(
      async () => {
        for (const p of perdedores) {
          const r = await fusionarProductosML(ganadorId, p.id);
          if ("error" in r) return r;
        }
        return { ok: true as const };
      },
      {
        ok: `Fichas unidas${movidas ? `: ${movidas} venta${movidas === 1 ? "" : "s"} pasaron a la ficha que se quedó` : "."}`,
        alExito: () => onFusionado(grupo.clave),
        siempre: () => setTrabajando(null),
      },
    );
  }

  if (grupos.length === 0) return null;

  const porSku = grupos.filter((g) => g.motivo === "sku").length;

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
        <p className="text-[13.5px] font-semibold">
          {grupos.length} artículo{grupos.length === 1 ? "" : "s"} con fichas repetidas
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          Mercado Libre tiene dos publicaciones sobre la <b>misma bodega</b> (la original y la que
          creó para su catálogo), y el CRM las importó como productos distintos.
          {porSku > 0 && (
            <>
              {" "}
              En otros {porSku === 1 ? "1 caso" : `${porSku} casos`} la publicación de ML terminó con
              el <b>mismo SKU</b> que la ficha de Tienda Nube después de que el CRM ya le había
              abierto ficha propia.
            </>
          )}{" "}
          Mientras estén separadas, el inventario se cuenta doble y las ventas se reparten entre las
          dos. Al unirlas el historial pasa a la ficha que se queda y el stock NO se suma: ya era el
          mismo.
        </p>
      </div>

      {grupos.map((g) => {
        const ocupado = pendiente && trabajando === g.clave;
        return (
          <div key={g.clave} className="flex flex-col gap-2 rounded-xl border bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {g.motivo === "sku"
                  ? `Mismo SKU en Tienda Nube y Mercado Libre · ${g.clave.slice(4)}`
                  : `Bodega compartida ${g.user_product_id}`}
                {g.stock_ml !== null && ` · ${g.stock_ml} u. en Mercado Libre`}
              </p>
              {g.ganador_id && (
                <Button
                  size="sm"
                  onClick={() => unir(g, g.ganador_id!)}
                  disabled={ocupado}
                  className="h-auto gap-1.5 rounded-[10px] px-3 py-1.5 text-[13px] font-semibold"
                >
                  <Merge className="size-[14px]" strokeWidth={1.9} aria-hidden="true" />
                  {ocupado ? "Uniendo…" : "Unir"}
                </Button>
              )}
            </div>

            {g.fichas.map((f) => (
              <Ficha key={f.id} ficha={f} esGanador={f.id === g.ganador_id}>
                {g.ganador_id ? (
                  f.id === g.ganador_id ? (
                    <span className="text-xs font-semibold text-green-700">Se queda</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Se une a la de arriba</span>
                  )
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => unir(g, f.id)}
                    disabled={ocupado}
                    className="h-auto rounded-[10px] px-2.5 py-1 text-xs font-semibold"
                  >
                    Quedarme con esta
                  </Button>
                )}
              </Ficha>
            ))}

            {!g.ganador_id && (
              <p className="text-xs italic text-muted-foreground">
                Ninguna está vinculada a Tienda Nube (o lo están las dos), así que elige tú cuál se
                queda: es la que conserva nombre, precio e imágenes.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
