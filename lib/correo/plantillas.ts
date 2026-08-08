/* ============================================================================
   lib/correo/plantillas.ts — Los mensajes que salen del módulo de empresas
   ----------------------------------------------------------------------------
   HTML a mano, con estilos EN LÍNEA y tabla de una columna. No es descuido: los
   clientes de correo (Outlook, Gmail) recortan el `<style>` de la cabecera y no
   entienden flex ni grid, así que cualquier cosa más moderna se ve rota justo en
   el correo que le llega al cliente.

   Cada plantilla devuelve `{ asunto, html, texto }` y no manda nada: enviar es de
   lib/correo/enviar.ts. Así se pueden probar leyéndolas.
   ============================================================================ */

import { formatearFechaLarga } from "@/lib/fecha";
import { obtenerPrioridad } from "@/lib/catalogos";

const MARCA = "#e84393";
const TINTA = "#1f2933";
const SUAVE = "#667085";

/* Escapa lo que viene de la base. Un título de tarea es texto que escribió una
   persona: si trae `<` o `&`, el correo se rompe (o peor, se convierte en una
   inyección de marcado en la bandeja de alguien). */
function esc(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* El armazón común: cabecera con la marca, cuerpo y pie. */
function envoltura(titulo: string, cuerpo: string, boton?: { texto: string; url: string }): string {
  return `<!doctype html><html lang="es"><body style="margin:0;padding:0;background:#f4f5f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <tr><td style="background:${MARCA};padding:18px 24px;color:#fff;font-size:15px;font-weight:700;">Fresafit</td></tr>
    <tr><td style="padding:24px;">
      <h1 style="margin:0 0 14px;font-size:18px;line-height:1.35;color:${TINTA};">${esc(titulo)}</h1>
      ${cuerpo}
      ${
        boton
          ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;"><tr>
               <td style="background:${MARCA};border-radius:10px;">
                 <a href="${boton.url}" style="display:inline-block;padding:11px 20px;color:#fff;text-decoration:none;font-size:14px;font-weight:600;">${esc(boton.texto)}</a>
               </td></tr></table>`
          : ""
      }
    </td></tr>
    <tr><td style="padding:16px 24px 22px;border-top:1px solid #eceef1;color:${SUAVE};font-size:12px;line-height:1.5;">
      Este aviso salió del CRM de Fresafit. Si no esperabas este correo, respóndelo y lo revisamos.
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

function parrafo(texto: string): string {
  return `<p style="margin:0 0 10px;font-size:14.5px;line-height:1.55;color:${TINTA};">${texto}</p>`;
}

function dato(etiqueta: string, valor: string): string {
  return `<p style="margin:0 0 6px;font-size:13.5px;line-height:1.5;color:${SUAVE};"><strong style="color:${TINTA};">${esc(etiqueta)}:</strong> ${esc(valor)}</p>`;
}

export type Mensaje = { asunto: string; html: string; texto: string };

/* ---------------------------------------------------------------------------
   Tarea nueva para ti
   --------------------------------------------------------------------------- */
export function correoTareaNueva(datos: {
  titulo: string;
  descripcion?: string | null;
  solicitante: string;
  empresa: string;
  prioridad: string;
  categoria?: string | null;
  fechaLimite?: string | null;
  url?: string | null;
}): Mensaje {
  const urgente = datos.prioridad === "urgente";
  const asunto = `${urgente ? "🔴 Urgente · " : ""}${datos.solicitante} te pidió: ${datos.titulo}`;

  const cuerpo = [
    parrafo(`<strong>${esc(datos.solicitante)}</strong> abrió una tarea en el espacio de <strong>${esc(datos.empresa)}</strong>.`),
    datos.descripcion ? parrafo(esc(datos.descripcion).replace(/\n/g, "<br>")) : "",
    `<div style="margin:16px 0;padding:14px 16px;background:#f8f9fb;border-radius:10px;">`,
    dato("Prioridad", obtenerPrioridad(datos.prioridad)?.nombre ?? datos.prioridad),
    datos.categoria ? dato("Categoría", datos.categoria) : "",
    datos.fechaLimite ? dato("Fecha límite", formatearFechaLarga(datos.fechaLimite)) : "",
    `</div>`,
  ].join("");

  return {
    asunto,
    html: envoltura(
      datos.titulo,
      cuerpo,
      datos.url ? { texto: "Ver la tarea", url: datos.url } : undefined,
    ),
    texto:
      `${datos.solicitante} te pidió: ${datos.titulo}\n\n` +
      `${datos.descripcion ?? ""}\n\n` +
      `Prioridad: ${datos.prioridad}` +
      (datos.fechaLimite ? `\nFecha límite: ${formatearFechaLarga(datos.fechaLimite)}` : "") +
      (datos.url ? `\n\n${datos.url}` : ""),
  };
}

/* ---------------------------------------------------------------------------
   Resumen del día (lo que no era urgente y se agrupó)
   --------------------------------------------------------------------------- */
export function correoResumenDiario(datos: {
  empresa: string;
  nuevas: { titulo: string; solicitante: string }[];
  vencidas: { titulo: string; fechaLimite: string }[];
  url?: string | null;
}): Mensaje | null {
  /* Sin nada que contar no se manda: un resumen diario vacío enseña a la gente a
     ignorar el remitente, y entonces tampoco leerán el que sí importa. */
  if (!datos.nuevas.length && !datos.vencidas.length) return null;

  const lista = (items: string[]) =>
    `<ul style="margin:0 0 14px;padding-left:20px;font-size:14px;line-height:1.6;color:${TINTA};">` +
    items.map((i) => `<li>${i}</li>`).join("") +
    `</ul>`;

  const cuerpo = [
    datos.nuevas.length
      ? `<p style="margin:0 0 8px;font-size:13px;font-weight:700;color:${SUAVE};text-transform:uppercase;letter-spacing:.4px;">Nuevas (${datos.nuevas.length})</p>` +
        lista(datos.nuevas.map((t) => `${esc(t.titulo)} <span style="color:${SUAVE};">— ${esc(t.solicitante)}</span>`))
      : "",
    datos.vencidas.length
      ? `<p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#b42318;text-transform:uppercase;letter-spacing:.4px;">Vencidas (${datos.vencidas.length})</p>` +
        lista(datos.vencidas.map((t) => `${esc(t.titulo)} <span style="color:${SUAVE};">— vencía el ${formatearFechaLarga(t.fechaLimite)}</span>`))
      : "",
  ].join("");

  return {
    asunto: `Resumen de ${datos.empresa}: ${datos.nuevas.length} nuevas, ${datos.vencidas.length} vencidas`,
    html: envoltura(
      "Lo que se movió hoy",
      cuerpo,
      datos.url ? { texto: "Abrir el espacio", url: datos.url } : undefined,
    ),
    texto:
      `Resumen de ${datos.empresa}\n\n` +
      datos.nuevas.map((t) => `• ${t.titulo} — ${t.solicitante}`).join("\n") +
      (datos.vencidas.length
        ? `\n\nVencidas:\n` + datos.vencidas.map((t) => `• ${t.titulo}`).join("\n")
        : ""),
  };
}

/* ---------------------------------------------------------------------------
   Una tarea pasó su fecha límite (va a las DOS partes: quien la pidió y quien
   la tiene que resolver — es el aviso que evita la llamada incómoda)
   --------------------------------------------------------------------------- */
export function correoTareaVencida(datos: {
  titulo: string;
  empresa: string;
  fechaLimite: string;
  responsable: string;
  url?: string | null;
}): Mensaje {
  return {
    asunto: `Venció: ${datos.titulo}`,
    html: envoltura(
      "Una tarea pasó su fecha",
      [
        parrafo(`<strong>${esc(datos.titulo)}</strong>, del espacio de ${esc(datos.empresa)}, venció el <strong>${formatearFechaLarga(datos.fechaLimite)}</strong> y sigue abierta.`),
        dato("A cargo de", datos.responsable),
      ].join(""),
      datos.url ? { texto: "Ver la tarea", url: datos.url } : undefined,
    ),
    texto: `Venció: ${datos.titulo} (${formatearFechaLarga(datos.fechaLimite)}). A cargo de ${datos.responsable}.`,
  };
}

/* ---------------------------------------------------------------------------
   Un documento está por caducar (constancias, permisos COFEPRIS…)
   --------------------------------------------------------------------------- */
export function correoDocumentoPorVencer(datos: {
  nombre: string;
  empresa: string;
  categoria: string;
  vigenteHasta: string;
  dias: number;
  url?: string | null;
}): Mensaje {
  return {
    asunto: `${datos.nombre} vence en ${datos.dias} días`,
    html: envoltura(
      "Un documento está por vencer",
      [
        parrafo(`<strong>${esc(datos.nombre)}</strong> (${esc(datos.categoria)}), de ${esc(datos.empresa)}, pierde vigencia el <strong>${formatearFechaLarga(datos.vigenteHasta)}</strong>.`),
        parrafo("Conviene pedir la versión nueva antes de que caduque: renovarla a tiempo evita frenar facturación o un envío."),
      ].join(""),
      datos.url ? { texto: "Ver el documento", url: datos.url } : undefined,
    ),
    texto: `${datos.nombre} (${datos.empresa}) vence el ${formatearFechaLarga(datos.vigenteHasta)}, en ${datos.dias} días.`,
  };
}
