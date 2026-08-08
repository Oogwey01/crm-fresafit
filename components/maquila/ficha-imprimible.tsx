"use client";

import { Printer } from "lucide-react";
import { CodigoBarras } from "@/components/maquila/codigo-barras";
import {
  obtenerAcabadoMaquila,
  obtenerColorPalanca,
  obtenerComboMaquila,
  obtenerModeloMaquila,
} from "@/lib/catalogos";
import { formatearFechaLarga } from "@/lib/fecha";
import type { PedidoMaquila } from "@/lib/types";

/* ============================================================================
   La hoja que acompaña cada pieza en el taller.
   ----------------------------------------------------------------------------
   Media carta, pensada para leerse con las manos ocupadas: el COLOR DE PALANCA
   y la FECHA PROMETIDA van gigantes porque son, en ese orden, el error más
   caro y el dato que ordena el día. El código de barras lleva el número de
   orden para escanear en vez de teclear.

   Mismo mecanismo que el reporte de dirección (components/reportes/imprimible):
   ruta propia, el shell no va al papel (aside + .no-imprimir), y el PDF lo hace
   el navegador — texto seleccionable, kilobytes. Sin auto-print: Eduardo puede
   querer solo mirarla desde el teléfono.
   ============================================================================ */
export function FichaImprimible({ pedido }: { pedido: PedidoMaquila }) {
  const modelo = obtenerModeloMaquila(pedido.modelo)?.nombre ?? pedido.modelo;
  const acabado = obtenerAcabadoMaquila(pedido.acabado)?.nombre ?? pedido.acabado;
  const palanca = obtenerColorPalanca(pedido.palanca_color);
  const combo = obtenerComboMaquila(pedido.combo);
  const d = pedido.envio_direccion;

  return (
    <>
      <style>{`
        @page { size: letter; margin: 12mm; }
        @media print {
          html, body { background: #fff !important; }
          aside, .no-imprimir { display: none !important; }
          main { padding: 0 !important; }
          .hoja { box-shadow: none !important; border: 0 !important; }
        }
        .hoja, .hoja * {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
      `}</style>

      <div className="no-imprimir mb-4 flex justify-end">
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-[11px] bg-primary px-4 py-2 text-[13.5px] font-semibold text-primary-foreground"
        >
          <Printer className="size-4" /> Imprimir ficha
        </button>
      </div>

      <div className="hoja mx-auto max-w-[680px] rounded-xl border bg-white p-6 text-[#1a1a1a] shadow-sm">
        {/* Encabezado: quién es el pedido y el código para escanear. */}
        <header className="flex items-start justify-between gap-4 border-b-[3px] border-[#e84393] pb-3">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#e84393]">
              Fresa Fit · Ficha de producción
            </div>
            <h1 className="mt-1 truncate text-[26px] font-bold leading-tight">
              {pedido.diseno ?? "Pedido de maquila"}
              {pedido.cantidad > 1 ? ` ×${pedido.cantidad}` : ""}
            </h1>
            <div className="mt-0.5 text-[13px] text-[#555]">
              Orden {pedido.numero_orden ?? "manual"} · {pedido.sku ?? "sin SKU"}
            </div>
          </div>
          <div className="shrink-0 text-center">
            <CodigoBarras valor={pedido.numero_orden ?? pedido.id.slice(0, 8)} alto={40} />
            <div className="mt-0.5 font-mono text-[11px] tracking-widest">
              {pedido.numero_orden ?? pedido.id.slice(0, 8)}
            </div>
          </div>
        </header>

        {/* El armado. */}
        <section className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2.5 text-[15px]">
          <Dato k="Modelo" v={modelo} />
          <Dato k="Acabado" v={acabado} />
          <Dato k="Talla" v={pedido.talla ?? "—"} grande />
          <Dato k="Color" v={pedido.color ?? "—"} />
        </section>

        {/* La palanca, en grande: es donde más se equivoca el armado. */}
        {pedido.requiere_palanca && (
          <section
            className="mt-4 rounded-xl border-2 px-4 py-3"
            style={{ borderColor: palanca ? "#1a1a1a" : "#d63031" }}
          >
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#555]">
              🔧 Palanca (etiquetar con sticker)
            </div>
            <div
              className="text-[34px] font-black uppercase leading-tight"
              style={{ color: palanca ? "#1a1a1a" : "#d63031" }}
            >
              {palanca ? palanca.nombre : "SIN DEFINIR — preguntar antes de armar"}
            </div>
          </section>
        )}

        {/* El combo, si lleva. */}
        {pedido.combo !== "ninguno" && (
          <section className="mt-3 rounded-xl border px-4 py-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#555]">
              🎁 Combo
            </div>
            <div className="text-[18px] font-bold">{combo?.nombre ?? pedido.combo}</div>
            <div className="text-[13.5px] text-[#555]">
              Diseño del accesorio:{" "}
              <strong>{pedido.combo_diseno ?? "el mismo del cinturón"}</strong>
            </div>
          </section>
        )}

        {/* La fecha, gigante. */}
        <section className="mt-4 rounded-xl bg-[#e84393]/10 px-4 py-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-[#a62568]">
            Fecha prometida al cliente
          </div>
          <div className="text-[32px] font-black leading-tight text-[#a62568]">
            {pedido.fecha_prometida ? formatearFechaLarga(pedido.fecha_prometida) : "sin fecha"}
          </div>
          <div className="text-[13px] font-medium text-[#a62568]">
            {pedido.ruta === "corte" && pedido.corte_fecha
              ? `Va en el corte del ${formatearFechaLarga(pedido.corte_fecha)} (${acabado.toLowerCase()}).`
              : "⚡ Producción directa: no espera corte."}
          </div>
        </section>

        {/* El envío. Solo lo que la guía pide. */}
        <section className="mt-4 border-t pt-3 text-[14px]">
          <div className="text-[11px] font-bold uppercase tracking-wider text-[#555]">
            Envío
          </div>
          <div className="mt-1 font-semibold">{pedido.envio_nombre ?? "—"}</div>
          {pedido.envio_telefono && <div>Tel. {pedido.envio_telefono}</div>}
          {d && (
            <div className="text-[#333]">
              {[
                [d.calle, d.numero].filter(Boolean).join(" "),
                d.colonia,
                [d.cp, d.ciudad].filter(Boolean).join(" "),
                d.estado,
              ]
                .filter(Boolean)
                .join(", ")}
              {d.referencias ? ` — Ref: ${d.referencias}` : ""}
            </div>
          )}
        </section>

        {pedido.notas && (
          <section className="mt-3 rounded-lg bg-[#f5f5f5] px-3 py-2 text-[13px]">
            <strong>Notas:</strong> {pedido.notas}
          </section>
        )}
      </div>
    </>
  );
}

function Dato({ k, v, grande }: { k: string; v: string; grande?: boolean }) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-[#555]">{k}</div>
      <div className={grande ? "text-[24px] font-black leading-tight" : "text-[16px] font-semibold"}>
        {v}
      </div>
    </div>
  );
}
