/* ============================================================================
   lib/correo/avisos.ts — Quién recibe qué, y cuándo
   ----------------------------------------------------------------------------
   Las plantillas (lib/correo/plantillas.ts) no saben a quién escribirle y el
   emisor (lib/correo/enviar.ts) no sabe por qué. Esto une las dos cosas: mira la
   tarea, decide a quién le toca enterarse y manda.

   La regla del módulo, tal cual se pidió:
     * lo URGENTE sale en el momento;
     * lo demás, a quien es de fuera, se junta en el resumen diario del cron
       (/api/cron/portal) para no convertir el CRM en una fuente de ruido;
     * al equipo de casa no se le manda correo por una tarea normal: para eso ya
       tiene la campana y el push, y con los que ve al día se le llenaría la
       bandeja.

   Correr esto necesita leer correos, que viven en `auth.users` y no en
   `profiles`: va con la llave de servicio, igual que hace /equipo. Por eso se
   llama SIEMPRE desde el servidor y dentro de `after()`.
   ============================================================================ */

import { createAdminClient } from "@/lib/supabase/admin";
import { baseDelCorreo, enviarCorreo, enviarCorreos, type CorreoSalida } from "@/lib/correo/enviar";
import { correoTareaNueva } from "@/lib/correo/plantillas";
import { obtenerCategoriaTarea } from "@/lib/catalogos";

/* El correo de una lista de personas, leído de auth.users con la llave de
   servicio. Devuelve un mapa id → correo; quien no tenga cuenta simplemente no
   aparece (y no recibe nada, en vez de romper el envío de los demás). */
export async function correosDe(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const limpios = [...new Set(ids.filter((id): id is string => !!id))];
  const mapa = new Map<string, string>();
  if (!limpios.length) return mapa;

  const admin = createAdminClient();
  /* `listUsers` pagina de 50 en 50 por defecto; el equipo más los contactos de
     los clientes caben de sobra en una página de 200. Si algún día no caben,
     esto se convierte en un bucle — pero pedir 200 para mandar tres correos ya
     es más de lo necesario. */
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) {
    console.warn("[correo] no se pudieron leer los correos:", error.message);
    return mapa;
  }
  for (const u of data.users) {
    if (u.email && limpios.includes(u.id)) mapa.set(u.id, u.email);
  }
  return mapa;
}

/* El enlace al que lleva el correo, según a quién se le escriba: la gente de
   fuera va a su portal y el equipo, al espacio de trabajo del cliente. Sin
   CORREO_BASE_URL configurada el mensaje sale sin botón (ver baseDelCorreo). */
function enlace(paraExterno: boolean, slugEmpresa: string | null): string | null {
  const base = baseDelCorreo();
  if (!base) return null;
  if (paraExterno) return `${base}/portal/tareas`;
  return slugEmpresa ? `${base}/agencia/clientes/${slugEmpresa}` : `${base}/agencia/tareas`;
}

/* Aviso de tarea nueva.

   A quién: al responsable si lo tiene; si no —el caso de un pedido que abre el
   cliente y todavía nadie ha tomado— a la gente de Fresafit asignada a esa
   cuenta (`agencia_asignaciones`), que es justo el equipo que la atiende. Sin
   asignaciones no se manda a nadie: mejor ningún correo que un correo a todo el
   CRM.

   Cuándo: si es urgente, o si quien lo tiene que resolver es de fuera (a esa
   persona no la alcanza ni la campana ni el push si no tiene la PWA instalada).
   El resto se lo queda el resumen diario. */
export async function avisarTareaNueva(taskId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: tarea } = await admin
    .from("tasks")
    .select("id, titulo, descripcion, prioridad, categoria, fecha_limite, responsable_id, created_by, empresa_id, visibilidad")
    .eq("id", taskId)
    .maybeSingle();

  if (!tarea || tarea.visibilidad !== "compartido") return;

  const [{ data: empresa }, { data: perfiles }] = await Promise.all([
    admin.from("agencia_empresas").select("nombre, slug").eq("id", tarea.empresa_id ?? "").maybeSingle(),
    admin.from("profiles").select("id, nombre, rol").in("id", [tarea.responsable_id, tarea.created_by].filter(Boolean) as string[]),
  ]);

  const porId = new Map((perfiles ?? []).map((p) => [p.id, p]));
  const solicitante = porId.get(tarea.created_by ?? "")?.nombre ?? "Fresafit";

  /* A quién escribirle. */
  let destinatarios: { id: string; externo: boolean }[] = [];
  if (tarea.responsable_id) {
    const p = porId.get(tarea.responsable_id);
    destinatarios = [{ id: tarea.responsable_id, externo: p?.rol === "externo" }];
  } else {
    const { data: equipo } = await admin
      .from("agencia_asignaciones")
      .select("profile_id")
      .eq("empresa_id", tarea.empresa_id ?? "")
      .eq("activo", true);
    destinatarios = (equipo ?? []).map((a) => ({ id: a.profile_id, externo: false }));
  }

  const urgente = tarea.prioridad === "urgente";
  /* A un externo se le escribe siempre; al equipo, solo si corre prisa. */
  const aQuienes = destinatarios.filter((d) => urgente || d.externo);
  if (!aQuienes.length) return;

  const correos = await correosDe(aQuienes.map((d) => d.id));

  const mensajes: CorreoSalida[] = [];
  for (const d of aQuienes) {
    const correo = correos.get(d.id);
    if (!correo) continue;
    const msg = correoTareaNueva({
      titulo: tarea.titulo,
      descripcion: tarea.descripcion,
      solicitante,
      empresa: empresa?.nombre ?? "tu cuenta",
      prioridad: tarea.prioridad,
      categoria: obtenerCategoriaTarea(tarea.categoria)?.nombre ?? null,
      fechaLimite: tarea.fecha_limite,
      url: enlace(d.externo, empresa?.slug ?? null),
    });
    mensajes.push({ para: correo, asunto: msg.asunto, html: msg.html, texto: msg.texto });
  }

  await enviarCorreos(mensajes);
}

/* Un envío suelto, para lo que ya viene armado desde el cron. */
export async function mandar(msg: CorreoSalida): Promise<void> {
  await enviarCorreo(msg);
}
