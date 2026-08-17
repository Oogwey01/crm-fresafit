"use server";

/* ============================================================================
   app/(app)/personalizados/acciones/correo.ts — Avisarle al cliente
   ----------------------------------------------------------------------------
   El único correo del CRM que sale hacia un cliente final. Todo lo demás que
   manda lib/correo/ va al equipo o a los contactos de las empresas, que ya
   saben que el CRM existe.

   Se dispara A MANO desde la ficha, no solo desde la siembra automática, y es a
   propósito: un personalizado recién vendido puede llegar con el nombre del
   comprador mal capturado o sin talla, y ese correo ya no se puede retirar de
   la bandeja de nadie. Que alguien lo revise y apriete es la última validación.

   Archivo aparte y no dentro de actions.ts —que ya pasa de 400 líneas y mezcla
   captura, importación y búsqueda de ventas— siguiendo la regla de acciones de
   ARQUITECTURA.md. Se importa directo desde el componente: actions.ts lleva
   "use server" en la primera línea, así que no puede hacer de barril.
   ============================================================================ */

import { revalidatePath } from "next/cache";
import { type Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import { enviarCorreo } from "@/lib/correo/enviar";
import { correoPersonalizadoConfirmado } from "@/lib/correo/plantillas";
import { correosDeClientes } from "@/lib/personalizados/correo-cliente";
import { fechaLimitePersonalizado } from "@/lib/personalizados/plazo";
import { MODELOS_PERSONALIZADO, TIPOS_PERSONALIZADO } from "@/lib/catalogos";

type Ficha = {
  id: string;
  cliente: string;
  no_venta: string | null;
  sale_order_id: string | null;
  tipo: string | null;
  modelo: string | null;
  talla: string | null;
  fecha_compra: string | null;
  fecha_limite: string | null;
  correo_enviado_en: string | null;
};

export async function enviarConfirmacionPersonalizado(
  id: string,
  /* Escribir dos veces al mismo cliente es el error caro de esta pantalla, así
     que el reenvío tiene que pedirse explícitamente. La UI lo pone en el texto
     de la confirmación cuando la ficha ya trae sello. */
  reenviar = false,
): Promise<Resultado<{ correo: string }>> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  const { data, error } = await cx.supabase
    .from("personalizados")
    .select(
      "id, cliente, no_venta, sale_order_id, tipo, modelo, talla, fecha_compra, fecha_limite, correo_enviado_en",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "No se encontró el personalizado." };
  const ficha = data as Ficha;

  if (ficha.correo_enviado_en && !reenviar) {
    return { error: "A este cliente ya se le mandó la confirmación." };
  }

  const correos = await correosDeClientes(cx.supabase, [ficha]);
  const correo = correos.get(ficha.id);
  if (!correo) {
    return {
      error:
        "No tenemos el correo de este cliente. Solo llega de Tienda Nube: Mercado Libre lo anonimiza y TikTok lo enmascara.",
    };
  }

  /* La fecha que se promete: la de la ficha si alguien la ajustó, y si no la
     que toca por plazo. Puede quedar en null —una ficha vieja sin fecha de
     compra— y entonces el correo sale sin fecha en vez de con una inventada. */
  const fechaEstimada = ficha.fecha_limite ?? fechaLimitePersonalizado(ficha.fecha_compra);

  const msg = correoPersonalizadoConfirmado({
    cliente: ficha.cliente,
    folio: ficha.no_venta,
    modelo: MODELOS_PERSONALIZADO.find((m) => m.id === ficha.modelo)?.nombre ?? null,
    talla: ficha.talla,
    tecnica: TIPOS_PERSONALIZADO.find((t) => t.id === ficha.tipo)?.nombre ?? null,
    fechaEstimada,
  });

  const envio = await enviarCorreo({
    para: correo,
    asunto: msg.asunto,
    html: msg.html,
    texto: msg.texto,
  });
  if (!envio.ok) {
    return {
      error:
        envio.error === "correo no configurado"
          ? "El envío de correo no está configurado en este entorno (falta RESEND_API_KEY)."
          : `No se pudo enviar: ${envio.error ?? "el proveedor no respondió"}.`,
    };
  }

  /* El correo YA salió: a partir de aquí nada puede fallar de forma que valga
     la pena presentarlo como fracaso. Si la RLS descartara el sello —cero filas
     y 204, el modo de fallo silencioso de ARQUITECTURA.md— se avisa en ámbar,
     porque el efecto irreversible ya ocurrió y lo que se perdió es la memoria
     de que ocurrió. */
  const { data: sellada, error: errSello } = await cx.supabase
    .from("personalizados")
    .update({ correo_enviado_en: new Date().toISOString(), correo_enviado_a: correo })
    .eq("id", id)
    .select("id");

  revalidatePath("/personalizados");

  if (errSello || !sellada?.length) {
    return {
      ok: true,
      advertencia: `El correo salió a ${correo}, pero no se pudo registrar en la ficha: si vuelves a darle, se manda otra vez.`,
      datos: { correo },
    };
  }

  return { ok: true, datos: { correo } };
}
