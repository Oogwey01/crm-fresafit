import { CheckCircle2, CircleAlert, FlaskConical, Lock, PenLine } from "lucide-react";
import type { EstadoPiloto } from "@/lib/inventario/piloto";
import { cn } from "@/lib/utils";

/* ============================================================================
   Monitor del piloto de escritura a canales
   ----------------------------------------------------------------------------
   Mientras el CRM va tomando el mando del inventario producto por producto,
   esto responde de un vistazo: quién está dentro, si los canales coinciden y
   qué les escribió el CRM. Se alimenta de la foto horaria y del ledger, así que
   no llama a ninguna API ni hace esperar a nadie.
   ============================================================================ */

const NOMBRE_CANAL: Record<string, string> = {
  tienda_nube: "Tienda Nube",
  mercado_libre: "Mercado Libre",
  tiktok_shop: "TikTok Shop",
  tiendanube: "Tienda Nube",
  mercadolibre: "Mercado Libre",
  tiktok: "TikTok Shop",
};

const ORIGEN_CORTO: Record<string, string> = {
  manual: "ajuste",
  venta_ml: "venta ML",
  venta_tn: "venta TN",
  venta_tiktok: "venta TikTok",
  tiendanube_sync: "sync TN",
  mercadolibre_sync: "sync ML",
  proveedor: "proveedor",
};

function hora(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Hermosillo",
  });
}

function Chip({ children, tono = "neutro" }: { children: React.ReactNode; tono?: "neutro" | "ok" | "aviso" }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-xs font-medium",
        tono === "ok" && "border-green-600/40 bg-green-600/10 text-green-700 dark:text-green-400",
        tono === "aviso" && "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
      )}
    >
      {children}
    </span>
  );
}

/* Celda de un canal: en rojo cuando no coincide con el CRM. */
function Celda({ valor, crm }: { valor: number | null; crm: number }) {
  if (valor === null) return <span className="text-muted-foreground/50">—</span>;
  return (
    <span className={cn("tabular-nums", valor !== crm ? "font-bold text-red-600" : "text-muted-foreground")}>
      {valor}
    </span>
  );
}

export function PanelPiloto({ estado }: { estado: EstadoPiloto }) {
  if (!estado.activo) return null;

  /* Con la escritura bloqueada el panel no desaparece: sigue sirviendo como
     monitor —muestra si los canales cuadran con el CRM y qué escribió antes de
     que se cerrara la llave—, pero no puede decir que está escribiendo. */
  const bloqueado = estado.modo === "off";
  const simulacro = estado.modo === "simulacro";
  const todoElCatalogo = estado.skus.length === 0;
  const desviados = estado.filas.filter((f) => !f.cuadrado);

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        {bloqueado ? (
          <Lock className="size-[18px] text-muted-foreground" strokeWidth={1.9} aria-hidden="true" />
        ) : simulacro ? (
          <FlaskConical className="size-[18px] text-amber-600" strokeWidth={1.9} aria-hidden="true" />
        ) : (
          <PenLine className="size-[18px] text-green-600" strokeWidth={1.9} aria-hidden="true" />
        )}
        <h3 className="text-[14.5px] font-semibold">
          {bloqueado
            ? "Escritura a canales desactivada"
            : simulacro
              ? "Piloto en simulacro"
              : "El CRM está escribiendo en los canales"}
        </h3>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Chip tono={estado.hubVentas ? "ok" : "neutro"}>
            ventas {estado.hubVentas ? "descuentan" : "no descuentan"}
          </Chip>
          {bloqueado ? (
            <Chip>solo lectura</Chip>
          ) : (
            estado.canales.map((c) => (
              <Chip key={c} tono={simulacro ? "aviso" : "ok"}>
                {NOMBRE_CANAL[c] ?? c}
              </Chip>
            ))
          )}
        </div>
      </div>

      <p className="text-[13px] leading-relaxed text-muted-foreground">
        {bloqueado
          ? "El CRM no modifica el stock ni ningún otro dato en Tienda Nube, Mercado Libre ni TikTok Shop. Lo de abajo es solo observación: cómo va cada canal y qué escribió el CRM cuando tenía permiso."
          : simulacro
            ? "El CRM calcula lo que escribiría y lo anota, pero no toca ninguna plataforma. Sirve para medir si acierta antes de darle permiso."
            : todoElCatalogo
              ? "El CRM manda el stock de TODO el catálogo y lo empuja a los canales."
              : `El CRM manda el stock de ${estado.skus.length} producto${estado.skus.length === 1 ? "" : "s"} (${estado.skus.join(", ")}). El resto del catálogo sigue como siempre.`}
      </p>

      {estado.filas.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-[13px]">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-1.5 font-medium">Producto</th>
                <th className="pb-1.5 font-medium">CRM</th>
                <th className="pb-1.5 font-medium">Tienda Nube</th>
                <th className="pb-1.5 font-medium">Mercado Libre</th>
                <th className="pb-1.5 font-medium">Último dato</th>
              </tr>
            </thead>
            <tbody>
              {estado.filas.map((f) => (
                <tr key={f.id} className="border-b last:border-0">
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-1.5">
                      {f.cuadrado ? (
                        <CheckCircle2 className="size-[15px] shrink-0 text-green-600" strokeWidth={2} aria-hidden="true" />
                      ) : (
                        <CircleAlert className="size-[15px] shrink-0 text-red-600" strokeWidth={2} aria-hidden="true" />
                      )}
                      <span className="font-medium">{f.sku ?? "—"}</span>
                      <span className="truncate text-muted-foreground" title={f.nombre}>
                        {f.nombre.slice(0, 32)}
                      </span>
                    </div>
                  </td>
                  <td className="py-2 pr-3 font-semibold tabular-nums">{f.stock_crm}</td>
                  <td className="py-2 pr-3">
                    <Celda valor={f.stock_tn} crm={f.stock_crm} />
                  </td>
                  <td className="py-2 pr-3">
                    <Celda valor={f.stock_ml} crm={f.stock_crm} />
                  </td>
                  <td className="py-2 text-xs text-muted-foreground">
                    {f.visto_en ? hora(f.visto_en) : "sin datos aún"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {desviados.length > 0 && (
        <p className="text-[12.5px] text-amber-700 dark:text-amber-400">
          {desviados.length === 1 ? "Un canal está" : `${desviados.length} canales están`} fuera del número
          del CRM.{" "}
          {bloqueado
            ? "Con la escritura desactivada el CRM no lo va a corregir: si el número del canal está mal, ajústalo en la plataforma."
            : "La próxima sincronización debería devolverlo; si no, revísalo."}
        </p>
      )}

      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Lo que el CRM ha escrito
        </p>
        {estado.movimientos.length === 0 ? (
          <p className="text-[13px] italic text-muted-foreground">
            Todavía no ha escrito nada en ningún canal.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {estado.movimientos.slice(0, 8).map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]">
                <span className="text-xs tabular-nums text-muted-foreground">{hora(m.creado_en)}</span>
                <span className="font-medium">{m.sku ?? "—"}</span>
                <span className="text-muted-foreground">{NOMBRE_CANAL[m.canal] ?? m.canal}</span>
                <span className="tabular-nums">
                  {m.stock_anterior ?? "?"} <span className="text-muted-foreground">→</span>{" "}
                  <b>{m.stock_nuevo}</b>
                </span>
                <span className="text-xs text-muted-foreground">
                  ({ORIGEN_CORTO[m.origen] ?? m.origen})
                </span>
                {m.simulado && <Chip tono="aviso">simulado</Chip>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
