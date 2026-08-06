import { redirect } from "next/navigation";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { createAdminClient } from "@/lib/supabase/admin";
import { exigirModulo } from "@/lib/supabase/guardia-modulo";
import { PanelEquipo } from "@/components/equipo/panel";
import type { ProfileConCorreo } from "@/lib/types";

export const metadata = { title: "Equipo · Fresafit" };

/* Quién es quién y qué alcanza cada quien.

   Es la pantalla desde la que dirección reparte el acceso —rol, área y quién
   entra a la Agencia— sin pedir SQL, y sobre todo la que contesta la pregunta
   que antes no tenía respuesta en pantalla: «¿qué puede ver esta persona?».
   Lo que se enseña ahí NO está escrito a mano: sale del mismo filtro con el que
   se pinta el menú (`modulosVisibles`), así que no puede desactualizarse.

   Solo dirección. El menú ya no la ofrece a nadie más, y aquí se cierra otra
   vez porque saberse la URL no es un permiso. */
export default async function EquipoPage() {
  /* `exigirModulo` ya aplica el `soloDireccion` del catálogo (y de paso la
     restricción por persona, por si alguien de dirección se la pusiera). */
  await exigirModulo("equipo");
  const { supabase, user } = await usuarioActual();
  if (!user) redirect("/login");

  const { data: perfiles, error } = await supabase
    .from("profiles")
    .select("id, nombre, rol, area, color, ve_agencia, modulos_ocultos")
    .order("nombre");
  if (error) throw new Error(`No se pudo cargar el equipo: ${error.message}`);

  /* El correo vive en `auth.users`, no en `profiles`, y esa tabla solo la lee la
     llave de servicio. Se pide aquí —después de comprobar que quien mira es
     dirección— porque es el dato con el que el dueño reconoce a cada quien:
     dos personas pueden llamarse parecido, el correo no. Si la llamada falla,
     la pantalla sigue sirviendo sin correos en vez de caerse. */
  const correos = new Map<string, string>();
  try {
    const { data } = await createAdminClient().auth.admin.listUsers({ page: 1, perPage: 200 });
    for (const u of data?.users ?? []) if (u.email) correos.set(u.id, u.email);
  } catch (e) {
    console.warn("[equipo] no se pudieron leer los correos:", e instanceof Error ? e.message : e);
  }

  const equipo: ProfileConCorreo[] = (perfiles ?? []).map((p) => ({
    ...(p as ProfileConCorreo),
    email: correos.get(p.id) ?? null,
  }));

  return <PanelEquipo equipo={equipo} currentUserId={user.id} />;
}
