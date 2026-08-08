"use server";

/* Acciones del portal de la empresa cliente.

   Son distintas de las de /tareas por una razón: de este lado NO se manda sobre
   la tarea. El cliente abre pedidos, comenta, adjunta y mueve el estado de lo
   que le toca — y eso es todo. Lo demás (título, responsable, prioridad,
   visibilidad) es del equipo, y el trigger `restringir_update_tarea` lo impone
   aunque alguien llame a PostgREST a mano.

   Todo lo de aquí es defensa en profundidad y, sobre todo, mensajes con
   palabras: el candado real son las policies de 20260915000000_portal_tareas.sql. */

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import { textoONulo } from "@/lib/validacion";
import { despacharPushPendientes } from "@/lib/push/enviar";
import { validarCierre } from "@/app/(app)/tareas/acciones/comun";
import { avisarTareaNueva } from "@/lib/correo/avisos";
import type { CategoriaTareaId, EstadoId } from "@/lib/types";

/* El portal y el espacio de trabajo del equipo enseñan las mismas tareas desde
   los dos lados: lo que pasa en uno tiene que verse en el otro. */
const RUTAS = ["/portal/tareas", "/agencia/tareas", "/agencia/clientes"];
const revalidar = () => RUTAS.forEach((r) => revalidatePath(r));

/* Los estados que el cliente maneja. No es la lista completa de `tasks`:
   `en_revision` es un paso del trabajo interno y no significa nada de este lado. */
const ESTADOS_CLIENTE: EstadoId[] = ["por_hacer", "en_proceso", "atorado", "hecho", "cancelada"];

export type PedidoInput = {
  titulo: string;
  descripcion: string;
  categoria: CategoriaTareaId | null;
  /* La empresa cliente no tiene un catálogo de prioridades interno: pide, y
     como mucho marca que corre prisa. `urgente` dispara el correo inmediato. */
  urgente: boolean;
  fecha_limite: string | null;
};

/* Abrir un pedido a Fresafit. Solo el administrador de la empresa: el
   colaborador comenta y sube archivos, pero no abre frentes nuevos (es la
   separación que pidió la spec, y la policy "tareas: crear (cliente admin)" la
   aplica).

   La tarea nace SIN responsable: quién la toma lo decide Fresafit desde su lado.
   Y nace `compartido` —si la pide el cliente, es para que la veamos—; la policy
   lo exige y aquí se manda explícito para no depender del default. */
export async function crearPedido(input: PedidoInput): Promise<Resultado> {
  const cx = await exigirRol(
    "cliente_admin",
    "Solo el administrador de tu empresa puede abrir pedidos. Puedes comentar y subir archivos en los que ya existen.",
  );
  if ("error" in cx) return cx;

  const titulo = input.titulo.trim();
  if (!titulo) return { error: "El pedido necesita un título." };

  const empresaId = cx.perfil?.empresa_id;
  if (!empresaId) return { error: "Tu cuenta no está ligada a ninguna empresa." };

  const { data, error } = await cx.supabase
    .from("tasks")
    .insert({
      titulo,
      descripcion: textoONulo(input.descripcion),
      responsable_id: null,
      espacio: "agencia",
      empresa_id: empresaId,
      visibilidad: "compartido",
      categoria: input.categoria,
      /* El área la ajusta Fresafit al tomar el pedido; entra por el default de
         la tabla para no obligar al cliente a adivinar nuestro organigrama. */
      area: "operaciones",
      prioridad: input.urgente ? "urgente" : "media",
      estado: "por_hacer",
      fecha_limite: input.fecha_limite || null,
      created_by: cx.user.id,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  revalidar();
  /* El correo al equipo sale por detrás: quien pidió ya vio su pedido en la
     lista mientras el aviso viaja. */
  after(async () => {
    await avisarTareaNueva(data.id);
    await despacharPushPendientes();
  });

  return { ok: true };
}

/* Mover el estado de una tarea del espacio compartido.

   Qué puede mover cada quien lo decide la BD: un colaborador no cierra ni
   cancela lo que abrió Fresafit (trigger `restringir_update_tarea`). Aquí se
   comprueba lo que la BD no sabe decir con palabras: que a la tarea le falte el
   adjunto o el comentario que su categoría exige para darse por cerrada. */
export async function moverPedido(id: string, estado: EstadoId): Promise<Resultado> {
  const cx = await exigirRol("cliente");
  if ("error" in cx) return cx;
  if (!ESTADOS_CLIENTE.includes(estado)) return { error: "Ese estado no existe." };

  const falta = await validarCierre(cx.supabase, id, estado);
  if (falta) return { error: falta };

  const { error } = await cx.supabase.from("tasks").update({ estado }).eq("id", id);
  if (error) return { error: error.message };

  revalidar();
  after(async () => {
    await despacharPushPendientes();
  });
  return { ok: true };
}

/* Comentar y adjuntar NO viven aquí: son `comentar`, `subirAdjunto` y
   `urlAdjunto` de app/(app)/tareas/actions.ts, que ya piden solo sesión y
   dejan que la RLS decida. Desde que `puede_ver_tarea()` conoce al cliente
   (20260915000000), esas tres funcionan igual desde los dos lados — y una copia
   aquí sería un segundo sitio donde arreglar el mismo error. */
