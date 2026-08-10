"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import {
  ligarDisenoDeBiblioteca,
  ligarPersonalizadoAPedido,
  sugerirPersonalizados,
} from "@/app/(app)/maquila/actions";
import { formatearFecha } from "@/lib/fecha";
import type { DisenoMaquila, PedidoMaquila, Personalizado } from "@/lib/types";

const SIN_VALOR = "sin_valor";

/* De dónde sale el arte de este pedido. Es el paso que sustituye al WhatsApp:
   una vez ligado, Eduardo descarga el diseño desde su propio tablero.

   Los personalizados se BUSCAN, no se listan: son cientos y el cruce se hace
   por número de venta (que es texto libre en esa tabla). La acción propone y
   una persona confirma — un match por texto no es una certeza. */
export function LigarDiseno({
  pedido,
  disenos,
}: {
  pedido: PedidoMaquila;
  disenos: DisenoMaquila[];
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [candidatos, setCandidatos] = useState<Personalizado[] | null>(null);

  if (pedido.personalizado_id || pedido.diseno_id) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-muted-foreground">
          {pedido.personalizado_id
            ? "Arte ligado a un personalizado."
            : `Arte de la biblioteca: ${disenos.find((d) => d.id === pedido.diseno_id)?.nombre ?? "—"}.`}
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            ejecutar(
              () =>
                pedido.personalizado_id
                  ? ligarPersonalizadoAPedido(pedido.id, null)
                  : ligarDisenoDeBiblioteca(pedido.id, null),
              { ok: "Arte desligado." },
            )
          }
        >
          Desligar
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-2 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">Sin arte ligado.</span>
        {candidatos === null && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              ejecutar(() => sugerirPersonalizados(pedido.id), {
                alExito: (r) => setCandidatos(r.datos.candidatos),
              })
            }
          >
            Buscar personalizado
          </Button>
        )}
        {disenos.length > 0 && (
          <Select
            value={SIN_VALOR}
            onValueChange={(v) =>
              v &&
              v !== SIN_VALOR &&
              ejecutar(() => ligarDisenoDeBiblioteca(pedido.id, v), {
                ok: "Diseño ligado. Eduardo ya puede descargarlo.",
              })
            }
          >
            <SelectTrigger className="h-8 w-[230px]">
              <SelectValue>{() => "…o de la biblioteca"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {disenos.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.coleccion ? `${d.coleccion} · ${d.nombre}` : d.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {candidatos !== null &&
        (candidatos.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">
            Ningún personalizado coincide con esta orden ni con el nombre del cliente.
          </p>
        ) : (
          <ul className="grid gap-1">
            {candidatos.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  {c.cliente}
                  <span className="text-muted-foreground">
                    {c.no_venta ? ` · venta ${c.no_venta}` : ""}
                    {c.fecha_compra ? ` · ${formatearFecha(c.fecha_compra)}` : ""}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    ejecutar(() => ligarPersonalizadoAPedido(pedido.id, c.id), {
                      ok: "Personalizado ligado. Eduardo ya ve el diseño.",
                      alExito: () => setCandidatos(null),
                    })
                  }
                >
                  Ligar
                </Button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
