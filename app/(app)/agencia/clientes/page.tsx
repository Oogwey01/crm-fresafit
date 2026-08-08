import Link from "next/link";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { exigirModulo } from "@/lib/supabase/guardia-modulo";
import { ESTADOS_CERRADOS } from "@/lib/catalogos";
import { esVencida } from "@/lib/fecha";
import type { AgenciaEmpresa } from "@/lib/types";

export const metadata = { title: "Clientes · Agencia Fresafit" };

/* La portada del espacio compartido: una tarjeta por cliente con lo que hay que
   saber de un vistazo — cuánto le debemos, cuánto nos debe y qué se pasó de
   fecha—. Desde aquí se entra al espacio de cada uno.

   Se lee de `tasks` en una sola consulta y se cuenta en memoria: son dos o tres
   clientes y unas decenas de tareas abiertas. Una consulta agregada por empresa
   sería más "correcta" y tres veces más código para el mismo número. */
export default async function ClientesAgenciaPage() {
  await exigirModulo("agencia-clientes");
  const { supabase } = await usuarioActual();

  const [empresasRes, tareasRes, contactosRes] = await Promise.all([
    supabase
      .from("agencia_empresas")
      .select("id, nombre, slug, color, giro, activa")
      .order("activa", { ascending: false })
      .order("nombre"),
    /* Solo lo abierto y compartido: es lo que mide el pulso de la relación.
       Lo interno de cada cuenta se ve dentro, en su pestaña. */
    supabase
      .from("tasks")
      .select("id, empresa_id, estado, fecha_limite, created_by, visibilidad")
      .eq("espacio", "agencia")
      .eq("visibilidad", "compartido")
      .is("deleted_at", null),
    supabase.from("profiles").select("id, empresa_id").not("empresa_id", "is", null),
  ]);

  const empresas = (empresasRes.data ?? []) as (Pick<
    AgenciaEmpresa,
    "id" | "nombre" | "slug" | "color" | "giro"
  > & { activa: boolean })[];

  /* Quién es de cada cliente: es lo que decide si una tarea la pidieron ellos o
     la pedimos nosotros. */
  const empresaDePersona = new Map(
    (contactosRes.data ?? []).map((p) => [p.id, p.empresa_id as string]),
  );

  const conteo = new Map<string, { nosPiden: number; pedimos: number; vencidas: number }>();
  for (const t of tareasRes.data ?? []) {
    if (!t.empresa_id) continue;
    if (ESTADOS_CERRADOS.includes(t.estado as (typeof ESTADOS_CERRADOS)[number])) continue;
    const c = conteo.get(t.empresa_id) ?? { nosPiden: 0, pedimos: 0, vencidas: 0 };
    /* «Nos piden» es desde el punto de vista de Fresafit: la abrió el cliente. */
    if (empresaDePersona.get(t.created_by ?? "")) c.nosPiden += 1;
    else c.pedimos += 1;
    if (esVencida(t.fecha_limite, t.estado)) c.vencidas += 1;
    conteo.set(t.empresa_id, c);
  }

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-[19px] font-bold">Clientes</h1>
        <p className="text-[13.5px] text-muted-foreground">
          El espacio que compartimos con cada empresa: lo que nos pedimos, los documentos y en qué
          va el proyecto.
        </p>
      </header>

      {empresas.length === 0 ? (
        <p className="rounded-xl border border-dashed py-10 text-center text-[14px] text-muted-foreground">
          No hay empresas dadas de alta.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {empresas.map((e) => {
            const c = conteo.get(e.id) ?? { nosPiden: 0, pedimos: 0, vencidas: 0 };
            return (
              <li key={e.id}>
                <Link
                  href={`/agencia/clientes/${e.slug}`}
                  className="flex h-full flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-accent/40"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="size-9 shrink-0 rounded-xl"
                      style={{ backgroundColor: e.color }}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 leading-tight">
                      <div className="truncate text-[15.5px] font-semibold">{e.nombre}</div>
                      <div className="truncate text-[12.5px] text-muted-foreground">
                        {e.giro ?? "—"}
                        {!e.activa && " · inactiva"}
                      </div>
                    </div>
                  </div>

                  <dl className="mt-auto flex gap-4 text-[13px]">
                    <div>
                      <dt className="text-muted-foreground">Nos piden</dt>
                      <dd className="text-[17px] font-bold">{c.nosPiden}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Pedimos</dt>
                      <dd className="text-[17px] font-bold">{c.pedimos}</dd>
                    </div>
                    {c.vencidas > 0 && (
                      <div>
                        <dt className="text-destructive">Vencidas</dt>
                        <dd className="text-[17px] font-bold text-destructive">{c.vencidas}</dd>
                      </div>
                    )}
                  </dl>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
