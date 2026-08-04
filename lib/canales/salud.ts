/* ============================================================================
   lib/canales/salud.ts — Lo que los canales saben y el CRM no mostraba
   ----------------------------------------------------------------------------
   Métricas trabaja con las ventas, que es lo que ya está en la base. Pero las
   plataformas guardan cosas que no llegan a `sales` y que explican POR QUÉ se
   vendió lo que se vendió:

     · Mercado Libre — cuánta gente vio las publicaciones (y por tanto qué
       porcentaje compró), y el estado de la cuenta: nivel, reclamos, demoras de
       despacho y cancelaciones. Ese semáforo decide si ML te muestra o te
       esconde, y hoy solo se ve entrando a su panel.
     · Tienda Nube — los carritos que quedaron a medias, y cómo paga la gente
       (tarjeta, meses, efectivo) y con qué cupón.

   Todo es de LECTURA. Cada bloque falla por su cuenta: si Mercado Libre se cae,
   Métricas sigue mostrando lo de Tienda Nube en vez de quedarse en blanco.

   Solo servidor.
   ============================================================================ */

import { unstable_cache } from "next/cache";
import { conexionMercadolibre, mlFetch } from "@/lib/mercadolibre/api";
import { conexionTiendanube } from "@/lib/tiendanube/api";
import { aMonto } from "@/lib/canales/ventas-cuadre";
import { diaMX } from "@/lib/fecha";

/* Cuánto vale cada respuesta antes de volver a preguntar.

   Estas tres llamadas se hacen a APIs ajenas y son lo que hacía que Métricas y
   Canales tardaran decenas de segundos: los carritos de Tienda Nube se paginan
   de 200 en 200 con un límite de 2 peticiones por segundo, y esa cuenta se
   repetía ENTERA en cada visita, aunque dos personas abrieran la misma pantalla
   con un minuto de diferencia.

   Un cuarto de hora de antigüedad no cambia ninguna decisión: son la reputación
   de 60 días, las visitas del mes y los carritos de 30 días. Ninguno se mira
   para reaccionar al minuto. */
const VIGENCIA_SEG = 15 * 60;

/* --------------------------- Mercado Libre -------------------------------- */

export type VisitasML = {
  total: number;
  /* Visitas por día (AAAA-MM-DD → visitas), para cruzarlas con las ventas. */
  porDia: Record<string, number>;
  desde: string;
  hasta: string;
};

/* Una métrica de reputación con sus dos caras. Mercado Libre puede EXCLUIR
   casos del cálculo (cuentas protegidas, incidencias que no imputa), y entonces
   publica una tasa mejor que la que salió de la operación real. `rate` es la
   cara que ML enseña; `realRate` es la que quedaría sin el indulto. */
export type MetricaSalud = { rate: number; realRate: number; real: number };

export type SaludML = {
  nivel: string | null; // "5_green" … el color del semáforo de ML
  /* El color que nos tocaría sin la protección. Cuando difiere de `nivel`, el
     que se ve en el panel de ML es prestado y vence en `protegidaHasta`. */
  nivelReal: string | null;
  protegidaHasta: string | null;
  categoria: string | null; // gold | platinum | silver
  ventasCompletadas: number;
  ventasCanceladas: number;
  calificaciones: { positivas: number; neutras: number; negativas: number };
  /* Métricas de los últimos 60 días. */
  reclamos: MetricaSalud;
  demoras: MetricaSalud;
  cancelaciones: MetricaSalud;
};

type ReputacionML = {
  seller_reputation?: {
    level_id?: string | null;
    /* Nivel sin la protección aplicada; solo viene en cuentas protegidas. */
    real_level?: string | null;
    protection_end_date?: string | null;
    power_seller_status?: string | null;
    transactions?: {
      completed?: number;
      canceled?: number;
      ratings?: { positive?: number; neutral?: number; negative?: number };
    };
    metrics?: Record<
      string,
      { rate?: number; value?: number; excluded?: { real_value?: number; real_rate?: number } }
    >;
  };
};

/* Visitas de TODAS las publicaciones del vendedor en los últimos N días.

   Se pide por vendedor y no publicación por publicación: la API acepta un solo
   ítem por llamada y el catálogo pasa de 300, que serían 300 peticiones para un
   número que ML ya tiene sumado. */
export const visitasML = unstable_cache(visitasMLSinCache, ["canales-visitas-ml"], {
  revalidate: VIGENCIA_SEG,
  tags: ["canales"],
});

async function visitasMLSinCache(dias: number): Promise<VisitasML | null> {
  const cx = await conexionMercadolibre();
  if (!cx) return null;
  try {
    const res = await mlFetch(
      cx,
      `/users/${cx.userId}/items_visits/time_window?last=${dias}&unit=day`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      total_visits?: number;
      date_from?: string;
      date_to?: string;
      results?: { date?: string; total?: number }[];
    };
    const porDia: Record<string, number> = {};
    for (const r of data.results ?? []) {
      if (r.date) porDia[diaMX(r.date)] = (porDia[diaMX(r.date)] ?? 0) + (r.total ?? 0);
    }
    return {
      total: data.total_visits ?? 0,
      porDia,
      desde: data.date_from ? diaMX(data.date_from) : "",
      hasta: data.date_to ? diaMX(data.date_to) : "",
    };
  } catch {
    return null;
  }
}

export const saludML = unstable_cache(saludMLSinCache, ["canales-salud-ml"], {
  revalidate: VIGENCIA_SEG,
  tags: ["canales"],
});

async function saludMLSinCache(): Promise<SaludML | null> {
  const cx = await conexionMercadolibre();
  if (!cx) return null;
  try {
    const res = await mlFetch(cx, `/users/${cx.userId}`);
    if (!res.ok) return null;
    const u = (await res.json()) as ReputacionML;
    const rep = u.seller_reputation;
    if (!rep) return null;

    const m = rep.metrics ?? {};
    const metrica = (clave: string): MetricaSalud => {
      const x = m[clave];
      return {
        rate: Number(x?.rate ?? 0),
        /* Sin casos excluidos, `real_rate` no viene y la tasa real ES la
           publicada: ahí no hay nada que descontar. */
        realRate: Number(x?.excluded?.real_rate ?? x?.rate ?? 0),
        real: Number(x?.excluded?.real_value ?? x?.value ?? 0),
      };
    };

    return {
      nivel: rep.level_id ?? null,
      nivelReal: rep.real_level ?? null,
      protegidaHasta: rep.protection_end_date ?? null,
      categoria: rep.power_seller_status ?? null,
      ventasCompletadas: rep.transactions?.completed ?? 0,
      ventasCanceladas: rep.transactions?.canceled ?? 0,
      calificaciones: {
        positivas: rep.transactions?.ratings?.positive ?? 0,
        neutras: rep.transactions?.ratings?.neutral ?? 0,
        negativas: rep.transactions?.ratings?.negative ?? 0,
      },
      reclamos: metrica("claims"),
      demoras: metrica("delayed_handling_time"),
      cancelaciones: metrica("cancellations"),
    };
  } catch {
    return null;
  }
}

/* ---------------------------- Tienda Nube --------------------------------- */

export type CarritosTN = {
  cantidad: number;
  /* Lo que había en esos carritos. Es la venta que se quedó en el camino, no un
     ingreso perdido garantizado, pero da la dimensión del hueco. */
  monto: number;
  /* Cuántos dejaron correo: son los recuperables con un mensaje. */
  conContacto: number;
  /* Se llegó al tope de páginas y hay más. Se dice en pantalla en vez de
     presentar un número corto como si fuera el total. */
  truncado: boolean;
};

type CheckoutTN = {
  id?: number;
  total?: string | null;
  contact_email?: string | null;
  completed_at?: { date?: string | null } | string | null;
  created_at?: string | null;
};

const POR_PAGINA = 200;
/* Tope de seguridad: 1 000 carritos bastan para dimensionar el hueco, y evita
   que una tienda con mucho tráfico convierta Métricas en veinte peticiones. */
const MAX_PAGINAS = 5;

/* Carritos abandonados de los últimos N días. Tienda Nube los llama "checkouts":
   son las compras que llegaron hasta el final y no se pagaron (el endpoint ya
   excluye las que sí se completaron: todas vienen con `completed_at` en null).

   Se pagina porque en 30 días pasan de 200, que era el tamaño de página: leer
   solo la primera daba un número redondo y falso. */
export const carritosAbandonadosTN = unstable_cache(
  carritosAbandonadosTNSinCache,
  ["canales-carritos-tn"],
  { revalidate: VIGENCIA_SEG, tags: ["canales"] },
);

async function carritosAbandonadosTNSinCache(dias: number): Promise<CarritosTN | null> {
  const cx = await conexionTiendanube();
  if (!cx) return null;
  try {
    const desde = new Date();
    desde.setDate(desde.getDate() - dias);
    const cabeceras = {
      Authorization: `bearer ${cx.token}`,
      Authentication: `bearer ${cx.token}`,
      "User-Agent": "CRM Fresafit (ovy3200@gmail.com)",
    };

    let cantidad = 0;
    let monto = 0;
    let conContacto = 0;
    let truncado = false;

    for (let page = 1; page <= MAX_PAGINAS; page++) {
      const res = await fetch(
        `https://api.tiendanube.com/2025-03/${cx.storeId}/checkouts?per_page=${POR_PAGINA}&page=${page}&created_at_min=${encodeURIComponent(desde.toISOString())}`,
        { headers: cabeceras, cache: "no-store" },
      );
      if (res.status === 404) break; // más allá de la última página
      if (!res.ok) return cantidad > 0 ? { cantidad, monto, conContacto, truncado: true } : null;

      const lista = (await res.json()) as CheckoutTN[];
      if (!Array.isArray(lista) || lista.length === 0) break;

      for (const c of lista) {
        /* Por si acaso: si alguna vez el endpoint devuelve completados, no
           cuentan como abandonados. */
        if (c.completed_at) continue;
        cantidad++;
        monto += aMonto(c.total);
        if (c.contact_email) conContacto++;
      }
      if (lista.length < POR_PAGINA) break;
      if (page === MAX_PAGINAS) truncado = true;
    }

    return { cantidad, monto: Math.round(monto * 100) / 100, conContacto, truncado };
  } catch {
    return null;
  }
}

/* --------------------- Cómo paga la gente (Tienda Nube) ------------------- */

/* Se calcula sobre las órdenes que ya se tienen en memoria durante la sync, no
   con una llamada aparte: los datos de pago vienen dentro de cada orden y
   pedirlos otra vez sería trabajo doble. Ver lib/tiendanube/ventas.ts. */
export type FormaDePago = {
  metodo: string; // "Tarjeta de crédito", "Efectivo"…
  cantidad: number;
  monto: number;
};

export type UsoCupon = {
  codigo: string;
  usos: number;
  /* Cuánto se dejó de cobrar por ese cupón en el periodo. */
  descuento: number;
};
