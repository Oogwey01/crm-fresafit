"use client";

import { useState } from "react";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pastilla } from "@/components/compartido/pastilla";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { SubirGuiaDialog } from "@/components/maquila/subir-guia-dialog";
import { urlGuiaMaquila } from "@/app/(app)/maquila/actions";
import { obtenerCanal, obtenerEstadoGuiaMaquila } from "@/lib/catalogos";
import { formatearFechaHora } from "@/lib/fecha";
import { direccionEnUnaLinea } from "@/lib/canales/direccion";
import type { GuiaMaquilaConPedidos } from "@/lib/types";

/* La bandeja de logística: los paquetes que Eduardo ya terminó y esperan su
   guía. «Favor de entregar guía», literal. Una fila por PAQUETE, no por
   renglón — una orden con tres cinturones lleva una sola etiqueta.

   Quien surte es el equipo interno; Eduardo ve la misma información desde su
   tablero, pero solo con el botón de descargar. */
export function GuiasMaquila({
  guias,
  puedeSurtir,
}: {
  guias: GuiaMaquilaConPedidos[];
  puedeSurtir: boolean;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [subirPara, setSubirPara] = useState<GuiaMaquilaConPedidos | null>(null);

  function descargar(id: string) {
    ejecutar(() => urlGuiaMaquila(id), {
      alExito: (r) => {
        window.open(r.datos.url, "_blank", "noopener");
      },
    });
  }

  const columnas: Columna<GuiaMaquilaConPedidos>[] = [
    {
      clave: "paquete",
      label: "Paquete",
      esTitulo: true,
      celda: (g) => {
        const primero = g.pedidos[0];
        return (
          <div className="min-w-0">
            <div className="truncate font-semibold">
              {g.pedidos.map((p) => p.diseno ?? p.sku ?? "Sin diseño").join(" + ") || "Sin renglones"}
            </div>
            <div className="truncate text-[12.5px] text-muted-foreground">
              {primero?.numero_orden ? `orden ${primero.numero_orden} · ` : ""}
              {obtenerCanal(g.canal)?.nombre ?? g.canal}
              {g.pedidos.length > 1 ? ` · ${g.pedidos.length} piezas` : ""}
            </div>
          </div>
        );
      },
    },
    {
      clave: "cliente",
      label: "Enviar a",
      celda: (g) => {
        const primero = g.pedidos[0];
        return (
          <div className="min-w-0">
            <div className="truncate">{primero?.envio_nombre ?? "—"}</div>
            <div className="truncate text-[11.5px] text-muted-foreground">
              {direccionEnUnaLinea(primero?.envio_direccion ?? null) || "—"}
            </div>
          </div>
        );
      },
    },
    {
      clave: "pedida",
      label: "Se pidió",
      celda: (g) => (
        <span className="text-muted-foreground">{formatearFechaHora(g.solicitada_en)}</span>
      ),
    },
    {
      clave: "estado",
      label: "Estado",
      celda: (g) => {
        const e = obtenerEstadoGuiaMaquila(g.estado);
        return (
          <div className="flex min-w-0 flex-col gap-1">
            {e && <Pastilla nombre={e.nombre} color={e.color} />}
            {g.num_guia && (
              <span className="truncate font-mono text-[11.5px] text-muted-foreground">
                {g.num_guia}
              </span>
            )}
          </div>
        );
      },
    },
    {
      clave: "acciones",
      label: "Guía",
      cardAncho: true,
      celda: (g) => (
        <div className="flex items-center gap-1.5">
          {g.archivo_path && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => descargar(g.id)}
              className="gap-1.5"
            >
              <Download className="size-3.5" />
              Descargar
            </Button>
          )}
          {puedeSurtir && (
            <Button
              size="sm"
              variant={g.archivo_path ? "outline" : "default"}
              disabled={pending}
              onClick={() => setSubirPara(g)}
              className="gap-1.5"
            >
              <Upload className="size-3.5" />
              {g.archivo_path ? "Reemplazar" : "Subir guía"}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <TablaSimple
        cols="grid-cols-[minmax(220px,1.4fr)_minmax(200px,1fr)_150px_140px_210px]"
        columnas={columnas}
        datos={guias}
        filaKey={(g) => g.id}
        minW="min-w-[960px]"
        filaClassName={(g) => (g.estado === "solicitada" ? "bg-amber-500/5" : "")}
        vacio="Ningún paquete espera guía. Cuando Eduardo marque uno como terminado, aparece aquí."
      />

      {subirPara && (
        <SubirGuiaDialog guia={subirPara} onClose={() => setSubirPara(null)} />
      )}
    </div>
  );
}
