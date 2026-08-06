import { redirect } from "next/navigation";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { destinoSeguro, obtenerModulo, puedeVerModulo } from "@/lib/catalogos";

/* Puerta de una sección del CRM.

   El menú ya no pinta lo que alguien no puede ver, pero esconder un botón no
   cierra una puerta: sin esto, quien tenga el enlace —un aviso reenviado, una
   pestaña vieja, un compañero dictando la URL— entraría igual. Por eso cada
   página de módulo empieza llamando aquí.

   Va por página y no en un sitio central a propósito: los layouts de Next no
   reciben la ruta, y averiguarla desde el middleware costaría una consulta de
   perfil en CADA request —el middleware evita a conciencia hasta el getUser(),
   que ya costaba ~200 ms—. Aquí no cuesta nada: `usuarioActual()` está cacheado
   por request, así que la página lo comparte con el layout que la envuelve.

   AL AGREGAR UNA PÁGINA NUEVA: si es un módulo del menú, su page.tsx empieza
   con `await exigirModulo("<id>")`. Sin esa línea la sección queda abierta a
   quien la tenga restringida.

   Se manda al primer módulo que la persona sí alcanza (casi siempre /tareas, la
   portada, que no se puede restringir) en vez de a un "no tienes acceso": una
   pantalla de rechazo solo informa de que hay algo detrás. */
export async function exigirModulo(moduloId: string): Promise<void> {
  const { user, perfil } = await usuarioActual();
  if (!user) redirect("/login?sesion=expirada");

  const modulo = obtenerModulo(moduloId);
  /* Un id que no existe es un error de programación, no un permiso: se deja
     pasar y se avisa por consola, porque cerrar una página por un dedazo en el
     id sería peor que abrirla. */
  if (!modulo) {
    console.warn(`[guardia] módulo desconocido: "${moduloId}"`);
    return;
  }

  if (!puedeVerModulo(modulo, perfil)) redirect(destinoSeguro(perfil));
}
