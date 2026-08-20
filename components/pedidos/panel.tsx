"use client";

import { useCallback, useEffect, useMemo, useOptimistic, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Clock,
  ExternalLink,
  Eye,
  PackageCheck,
  Printer,
  Send,
  Truck,
} from "lucide-react";
import {
  CANALES,
  ESTADOS_PEDIDO,
  ESTADOS_PEDIDO_PENDIENTES,
  esGestor,
  obtenerCanal,
  obtenerEstadoMaquila,
  obtenerEstadoPedido,
  obtenerEtapaEmpaque,
} from "@/lib/catalogos";
import { esPedidoAtrasado, formatearFecha, formatearFechaHora, hoyISO } from "@/lib/fecha";
import { PREPARACION, SITUACION } from "@/lib/canales/despacho";
/* La clasificación vive en lib/ para que la tabla y el tablero repartan IGUAL:
   si discreparan en qué es "por empacar", los números de las pestañas dejarían
   de cuadrar con lo que se ve. */
import {
  DIAS_TRANSITO_VISIBLE,
  bandeja,
  diasEnTransito,
  entraAlTablero,
  esPersonalizado,
  esUrgente,
  hayTrabajo,
  numeroOrden,
  plazoUrgente,
  preparacion,
  rangoEstado,
  type Bandeja,
} from "@/lib/pedidos/bandejas";
import { nombreVenta } from "@/lib/ventas";
import { urlOrdenCanal, urlRastreo } from "@/lib/pedidos/rastreo";
import type { EnProduccion } from "@/lib/pedidos/produccion";
import {
  cambiarEstadoPedido,
  listarPedidosHistorico,
  moverEtapaEmpaque,
} from "@/app/(app)/pedidos/actions";
import type {
  CanalId,
  EstadoPedidoId,
  EtapaEmpaqueId,
  RolId,
  PedidoEnvio,
} from "@/lib/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pastilla } from "@/components/compartido/pastilla";
import { BarraHerramientas } from "@/components/compartido/barra-herramientas";
import { CampoBusqueda } from "@/components/compartido/campo-busqueda";
import { Resaltado } from "@/components/compartido/resaltado";
import { StatCard } from "@/components/compartido/stat-card";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { ControlSegmentado } from "@/components/compartido/control-segmentado";
import { EnvioDialog } from "@/components/pedidos/envio-dialog";
import { TableroEmpaque } from "@/components/pedidos/tablero-empaque";
import { cn } from "@/lib/utils";

/* Las VISTAS de la pantalla. "Entregados" era una y salió de aquí: ahora es un
   estado más del selector, que además alcanza los cancelados —que no tenían
   forma de verse solos— y no deja combinar "Entregados" con "estado: nuevo",
   que solo podía dar una tabla vacía. */
type Vista = "por_empacar" | "urgentes" | "listos" | "full" | "en_camino" | "todos";

/* Cómo se ve «Por empacar»: la lista de siempre, o la mesa de bodega.

   El tablero manda por defecto porque es la vista con la que se trabaja —lo
   pidió bodega, que hasta ahora llevaba las etapas en un rastreador fuera del
   CRM—, y la tabla se queda a un clic porque es la única que enseña la guía, el
   rastreo y el botón de imprimir la etiqueta. */
type Modo = "tablero" | "tabla";

/* Etiqueta, regla y mensaje de vacío de cada vista, JUNTOS. Antes vivían en tres
   escaleras de ternarios paralelas —una para filtrar, otra para el vacío, otra
   para el conteo—, y con seis vistas la sexta se habría olvidado en alguna. */
const VISTAS: {
  id: Vista;
  label: string;
  /* Qué filas entran. `null` = todas, histórico incluido. */
  filtra: ((p: PedidoEnvio, ahora: number) => boolean) | null;
  vacio: string;
  /* Listas que se leen al revés: lo que lleva más tiempo esperando es lo que hay
     que atender, y el orden normal —lo más nuevo arriba— lo manda al fondo. */
  masViejosPrimero?: boolean;
}[] = [
  {
    id: "por_empacar",
    label: "Por empacar",
    filtra: (p) => bandeja(p) === "por_empacar",
    vacio: "No queda nada por empacar. Todo al día. 🎉",
  },
  {
    id: "urgentes",
    label: "Urgentes",
    /* Lo que hay que mover HOY. No es una bandeja: es un recorte de la de
       bodega. El `bandeja(p)` es redundante mientras `esUrgente` exija
       `hayTrabajo`, y va escrito de todos modos para que un cambio futuro en
       esa función no cuele un Full aquí sin que nadie lo note. */
    filtra: (p, ahora) =>
      bandeja(p) === "por_empacar" &&
      (esUrgente(p, ahora) || plazoUrgente(p, ahora) === "por_vencer"),
    vacio: "Nada urgente: ningún pedido con el plazo encima. 🎉",
  },
  {
    id: "listos",
    label: "Listos",
    filtra: (p) => bandeja(p) === "listos",
    vacio: "Ningún paquete esperando recolección.",
    masViejosPrimero: true,
  },
  {
    id: "full",
    label: "Full",
    filtra: (p) => bandeja(p) === "full",
    vacio: "Nada en Mercado Full.",
  },
  {
    id: "en_camino",
    label: "En camino",
    filtra: (p) => bandeja(p) === "en_camino",
    vacio: "Ningún paquete en la calle.",
    masViejosPrimero: true,
  },
  { id: "todos", label: "Todos", filtra: null, vacio: "No hay pedidos que mostrar." },
];

/* Los estados que ya no dan trabajo viven en el histórico, que la página no
   carga de entrada: pedirlos exige traerlo primero. */
function esEstadoTerminal(e: EstadoPedidoId): boolean {
  return !(ESTADOS_PEDIDO_PENDIENTES as readonly string[]).includes(e);
}

/* La última columna llevaba 60 px y el envío ("Estafeta MX 905590979741C70…")
   salía cortado sin remedio; ahora es la más ancha de la fila, que es lo que
   corresponde a la información con la que uno trabaja al empacar. La primera
   creció de 88 a 112 px para que quepa la pastilla del plazo de despacho, y de
   112 a 148 para la de "Listo para recolección" —el nombre es el que usa el
   panel de Mercado Libre y acortarlo obligaría a traducir de una pantalla a la
   otra—. */
const COLS = "grid-cols-[148px_minmax(170px,1fr)_130px_120px_118px_minmax(215px,250px)]";

/* La guía imprimible DIRECTA: solo cuando el clic de verdad entrega la
   etiqueta (hoy: Mercado Libre con id de envío → PDF de su API). Cuando no la
   hay, la impresora no se pinta — mandar "imprimir" al detalle del pedido
   confundía, era un "ver pedido" disfrazado. */
function urlEtiquetaDirecta(p: PedidoEnvio): string | null {
  if (p.estado !== "nuevo" && p.estado !== "preparando") return null;
  if (p.canal === "mercado_libre" && p.envio_id) {
    return `/api/mercadolibre/etiqueta?envio=${encodeURIComponent(p.envio_id)}`;
  }
  return null;
}

/* Pedir la etiqueta NO es mirarla: para Mercado Libre, entregar el PDF ES el
   acto de imprimir. Sella `date_first_printed` y empuja el envío a `printed` y
   de ahí a `ready_for_pickup` — o sea, el pedido queda anunciado como listo
   para que pase la colecta, sin que nadie haya empacado nada.

   El 17/08/2026 le pasó a un cinturón del día 14: apareció impreso a las 11:31
   y bodega no había tocado esa guía. Por eso esto dejó de ser un `<a href>`.
   Un enlace es un GET, y un GET lo puede disparar el navegador solo —una
   precarga especulativa, una extensión que adelanta los enlaces al pasar el
   ratón— con la sesión ya puesta y sin un clic de por medio. Como botón, hace
   falta la intención: un clic y un sí.

   La advertencia dice lo que va a pasar en el canal, no lo que va a pasar en el
   CRM: quien la lee está a punto de comprometer una recolección. */
function imprimirGuia(url: string) {
  const seguro = window.confirm(
    "Mercado Libre va a dar esta guía por IMPRESA y el pedido pasará a «Listo para recolección».\n\n" +
      "Hazlo solo si de verdad vas a imprimirla y empacar el paquete.\n\n¿Continuar?",
  );
  if (!seguro) return;
  window.open(url, "_blank", "noopener");
}

/* "Ver pedido": la orden en el panel del canal, que es donde se imprime la
   guía cuando no hay PDF directo. Tienda Nube va por la ruta de etiqueta: hoy
   redirige al admin (Envío Nube no publica el PDF en la API), y el día que lo
   publique, este mismo enlace lo entregará sin tocar nada. */
function urlVerPedido(p: PedidoEnvio, dominioTN?: string | null): string | null {
  const ref = p.referencia_externa ? numeroOrden(p.referencia_externa) : "";
  if (p.canal === "tienda_nube" && /^\d+$/.test(ref)) {
    return `/api/tiendanube/etiqueta?orden=${encodeURIComponent(ref)}`;
  }
  return urlOrdenCanal(p.canal, ref, dominioTN, p.url_orden);
}

function PastillaEstado({ estado }: { estado: string }) {
  const e = obtenerEstadoPedido(estado);
  if (!e) return null;
  return <Pastilla nombre={e.nombre} color={e.color} />;
}

export function PanelPedidos({
  pedidos,
  rol,
  dominioTiendaNube,
  ahora,
  enProduccion,
}: {
  pedidos: PedidoEnvio[];
  rol: RolId;
  /* Qué ventas están en el taller y en qué van (lib/pedidos/produccion.ts). Un
     personalizado no se empaca: primero hay que fabricarlo. */
  enProduccion: EnProduccion;
  /* Subdominio del panel de la tienda; sin él no se puede enlazar la orden de
     Tienda Nube (cada tienda tiene el suyo). Ver app/(app)/pedidos/page.tsx. */
  dominioTiendaNube?: string | null;
  /* Un solo "ahora" tomado por request en el servidor: dos pedidos con el mismo
     plazo de despacho deben clasificar igual (mismo criterio que el tablero de
     ML, ver instanteDeCorte). */
  ahora: number;
}) {
  const gestor = esGestor(rol);
  /* Cancelar retira la venta de Métricas y devuelve stock: es del lado del
     dinero y la BD lo reserva a dirección (ver 20261020000000). Ofrecerlo a
     quien no puede solo produce un error al soltar el clic; el resto del ciclo
     del envío lo mueve cualquiera del equipo. */
  const estadosQuePuedePoner =
    rol === "direccion" ? ESTADOS_PEDIDO : ESTADOS_PEDIDO.filter((e) => e.id !== "cancelado");
  const [filtro, setFiltro] = useState<Vista>("por_empacar");
  const [filtroCanal, setFiltroCanal] = useState<CanalId | "todos">("todos");
  const [filtroEstado, setFiltroEstado] = useState<EstadoPedidoId | "todos">("todos");
  const [busqueda, setBusqueda] = useState("");
  const [envio, setEnvio] = useState<PedidoEnvio | null>(null);
  const { ejecutar } = useAccionServidor();

  /* Parche optimista sobre la lista del servidor: arrastrar una tarjeta y verla
     volver a su columna medio segundo hasta que llega el `revalidatePath` se
     siente exactamente igual que un fallo. Reemplaza a `pedidos` en TODO lo que
     sigue, así que de paso el selector de estado de la tabla y los KPIs también
     dejan de esperar. El patrón es el del tablero de Tareas. */
  const [lista, aplicarParche] = useOptimistic(
    pedidos,
    (estado, m: { id: string; patch: Partial<PedidoEnvio> }) =>
      estado.map((p) => (p.id === m.id ? { ...p, ...m.patch } : p)),
  );

  /* Cómo se ve «Por empacar». Vive en la URL —y solo cuando no es el default—
     para que volver al pedido, o mandarle el enlace a alguien, caiga en la misma
     vista. `replaceState` y no `router.push`: misma entrada de historial y sin
     ida al servidor, que ni lee este parámetro. */
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [modo, setModo] = useState<Modo>(() =>
    searchParams.get("modo") === "tabla" ? "tabla" : "tablero",
  );
  useEffect(() => {
    /* Se parte de la query que hay y solo se toca `modo`, en vez de reconstruir
       la cadena entera como hace Tareas: allá TODOS los filtros viven en la URL,
       aquí solo éste, y rehacerla borraría cualquier otro parámetro con el que
       hubieran entrado. El default no se escribe, para que /pedidos a secas siga
       limpio. */
    const q = new URLSearchParams(window.location.search);
    if (modo === "tablero") q.delete("modo");
    else q.set("modo", modo);
    const qs = q.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }, [modo, pathname]);

  /* La página ya solo carga lo que da trabajo; los entregados y cancelados de
     la ventana se piden UNA vez, la primera vez que alguien sale del filtro de
     pendientes. `null` = aún no se han pedido. */
  const [historico, setHistorico] = useState<PedidoEnvio[] | null>(null);
  const [cargandoHistorico, setCargandoHistorico] = useState(false);

  function asegurarHistorico() {
    if (historico !== null || cargandoHistorico) return;
    setCargandoHistorico(true);
    /* Sin `ok`: es una lectura, y los pedidos que aparecen ya son el acuse. */
    ejecutar(() => listarPedidosHistorico(), {
      error: "No se pudo cargar el histórico. Revisa tu conexión.",
      alExito: (r) => setHistorico(r.pedidos),
      siempre: () => setCargandoHistorico(false),
    });
  }

  /* Activos + histórico, sin repetir (si un pedido está en ambos, manda la
     copia activa: es la más fresca) y en el mismo orden que trae el servidor. */
  const conHistorico = useMemo(() => {
    if (!historico) return lista;
    const porId = new Map<string, PedidoEnvio>();
    for (const p of historico) porId.set(p.id, p);
    for (const p of lista) porId.set(p.id, p);
    return [...porId.values()].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
  }, [lista, historico]);

  const conteo = useMemo(() => {
    /* Una sola pasada: los números de las pestañas y los de las tarjetas salen
       de la MISMA clasificación, así que no pueden contradecirse. Antes el KPI
       "Atrasados" contaba solo lo vencido y la pestaña "Urgentes" contaba
       además lo que vence en horas: dos cifras parecidas que nunca cuadraban. */
    const bandejas: Record<Bandeja, number> = { por_empacar: 0, listos: 0, full: 0, en_camino: 0 };
    let urgentes = 0,
      urgentesBodega = 0,
      sinEmpezar = 0,
      personalizados = 0,
      enTransito = 0;
    for (const p of lista) {
      const b = bandeja(p);
      bandejas[b]++;
      if (b === "por_empacar") {
        const deTaller = esPersonalizado(p, enProduccion);
        if (deTaller) personalizados++;
        if (p.estado === "nuevo") sinEmpezar++;
        if (esUrgente(p, ahora) || plazoUrgente(p, ahora) === "por_vencer") {
          /* `urgentes` es el de la pestaña —las dos mitades— y `urgentesBodega`
             el de la tarjeta, que solo habla de lo que se puede empacar hoy: al
             de una pieza que aún está en el taller no se le corre, se le
             pregunta a Maquila. */
          urgentes++;
          if (!deTaller) urgentesBodega++;
        }
      } else if (b === "en_camino" && diasEnTransito(p) !== null) enTransito++;
    }
    return { bandejas, urgentes, urgentesBodega, sinEmpezar, personalizados, enTransito };
    /* `enProduccion` entra por `esPersonalizado`: llega del servidor y solo
       cambia cuando cambian los pedidos, pero va en las dependencias para que el
       conteo no se quede viejo si un día deja de venir junto. */
  }, [lista, ahora, enProduccion]);

  /* El número de cada pestaña. "Todos" no lleva: depende del histórico, que
     puede no estar cargado todavía, y una cifra que cambia sola al hacer clic
     miente más de lo que informa. */
  function numeroDeVista(id: Vista): number | null {
    if (id === "todos") return null;
    return id === "urgentes" ? conteo.urgentes : conteo.bandejas[id];
  }

  const vistaActual = VISTAS.find((v) => v.id === filtro)!;

  /* Cambiar de vista desde los DOS controles (el selector del teléfono y el
     segmentado del escritorio). Centralizado para que el histórico no se quede
     sin pedir en uno de ellos. */
  function cambiarVista(id: Vista) {
    setFiltro(id);
    if (id === "todos") void asegurarHistorico();
  }


  /* Canal y búsqueda: los dos filtros que valen para CUALQUIER lista de esta
     pantalla —la tabla y el tablero— y que por eso se aplican aparte del filtro
     de vista. Se declara con useCallback porque el tablero lo usa dentro de su
     propio useMemo. */
  const buscarYFiltrarCanal = useCallback(
    (arr: PedidoEnvio[]) => {
      /* Hasta hace poco el canal se pintaba pero no se podía filtrar, y
         "enséñame solo lo de Mercado Libre" es justo lo que se pide al empacar. */
      const porCanal = filtroCanal === "todos" ? arr : arr.filter((p) => p.canal === filtroCanal);
      const q = busqueda.trim().toLowerCase();
      if (!q) return porCanal;
      /* Se busca por lo que uno tiene a mano cuando pregunta por un pedido: el
         nombre del cliente, el número de guía o la referencia de la orden. */
      return porCanal.filter(
        (p) =>
          (p.cliente?.nombre ?? "").toLowerCase().includes(q) ||
          (p.num_guia ?? "").toLowerCase().includes(q) ||
          (p.paqueteria ?? "").toLowerCase().includes(q) ||
          (p.referencia_externa ?? "").toLowerCase().includes(q) ||
          nombreVenta(p).toLowerCase().includes(q),
      );
    },
    [filtroCanal, busqueda],
  );

  const visibles = useMemo(() => {
    /* Un estado concreto manda sobre la vista: quien pide "enséñame lo que está
       preparando" quiere ESO, sin que la vista de arriba se lo recorte. Los
       terminales salen del histórico (el selector se encarga de pedirlo). */
    const porEstado =
      filtroEstado !== "todos"
        ? (esEstadoTerminal(filtroEstado) ? conHistorico : lista).filter(
            (p) => p.estado === filtroEstado,
          )
        : vistaActual.filtra
          ? lista.filter((p) => vistaActual.filtra!(p, ahora))
          : conHistorico;

    const encontrados = buscarYFiltrarCanal(porEstado);

    /* El servidor manda lo más nuevo primero, que es lo correcto para empacar
       —lo de hoy es lo que tiene el plazo vivo— y justo al revés en las listas de
       espera: el paquete que lleva 18 días en la calle quedaba en el renglón 169.
       Se invierte solo si lo pide la vista, y no cuando el usuario forzó un
       estado: ahí manda su elección, no la pestaña. La lista ya viene ordenada
       por fecha y filtrar conserva el orden, así que invertir al final es exacto
       y no exige volver a ordenar. */
    return vistaActual.masViejosPrimero && filtroEstado === "todos"
      ? [...encontrados].reverse()
      : encontrados;
  }, [lista, conHistorico, vistaActual, buscarYFiltrarCanal, filtroEstado, ahora]);

  /* Los personalizados salen a su propia tabla, debajo, en las dos vistas de
     trabajo: "Por empacar" y "Urgentes". Son las que se abren para decidir qué
     hacer AHORA, y ahí estorban — esas piezas todavía no existen, las está
     haciendo el taller—. En Urgentes pesan todavía más: 41 de los 77 son
     personalizados, así que sin separar, la lista de "lo que se me está pasando"
     era mayoría trabajo que no depende de bodega.

     En "Todos" o filtrando por un estado NO se parte: ahí partir la lista
     escondería la mitad de lo que se pidió ver. */
  const partirPorProduccion =
    (filtro === "por_empacar" || filtro === "urgentes") && filtroEstado === "todos";
  const enBodega = partirPorProduccion ? visibles.filter((p) => !esPersonalizado(p, enProduccion)) : visibles;
  const enTaller = partirPorProduccion ? visibles.filter((p) => esPersonalizado(p, enProduccion)) : [];

  /* El tablero solo tiene sentido en «Por empacar»: en «En camino» o en el
     histórico no hay ninguna caja que mover, y el toggle ni se ofrece. */
  const hayTablero = filtro === "por_empacar" && filtroEstado === "todos";
  /* Parte de la lista completa y NO de `visibles`: lo recolectado hace un rato
     ya pasó a "enviado", así que el filtro de la vista —que solo deja pasar la
     bandeja de por empacar— lo habría tirado, y la última columna se vaciaría en
     el mismo gesto de soltar la tarjeta ahí. Los filtros que sí valen (canal y
     búsqueda) se aplican igual que en la tabla. */
  const enTablero = useMemo(
    () =>
      hayTablero
        ? buscarYFiltrarCanal(lista.filter((p) => entraAlTablero(p, enProduccion, hoyISO())))
        : [],
    [hayTablero, lista, buscarYFiltrarCanal, enProduccion],
  );

  /* Recibe el pedido entero, y no solo su id, para que el aviso pueda nombrarlo
     igual que la columna de la tabla. */
  function cambiar(p: PedidoEnvio, estado: EstadoPedidoId) {
    ejecutar(() => cambiarEstadoPedido(p.id, estado), {
      ok: `${nombreVenta(p)} → ${obtenerEstadoPedido(estado)?.nombre ?? estado}.`,
      error: "No se pudo actualizar el pedido. Revisa tu conexión.",
      optimista: () => aplicarParche({ id: p.id, patch: { estado } }),
    });
  }

  /* Mover una tarjeta en el tablero. El parche optimista repite en el cliente lo
     que hace la RPC —incluido el avance de `estado`, que es lo que decide si la
     tarjeta sigue en el tablero— para que soltar y ver el resultado sea el mismo
     gesto. `etapa_empaque_en` se sella con la hora local: el servidor pondrá la
     suya al revalidar y la diferencia es de milisegundos. */
  function moverEtapa(p: PedidoEnvio, etapa: EtapaEmpaqueId) {
    const avance: EstadoPedidoId | null =
      etapa === "recolectado" ? "enviado" : etapa === "preparado" ? null : "preparando";
    ejecutar(() => moverEtapaEmpaque(p.id, etapa), {
      ok: `${nombreVenta(p)} → ${obtenerEtapaEmpaque(etapa)?.nombre ?? etapa}.`,
      error: "No se pudo mover el paquete. Revisa tu conexión.",
      optimista: () =>
        aplicarParche({
          id: p.id,
          patch: {
            etapa_empaque: etapa,
            etapa_empaque_en: new Date().toISOString(),
            /* Solo hacia adelante, igual que `avanzar_estado_pedido` en la BD:
               arrastrar hacia atrás corrige la mesa, no desanda el canal. */
            ...(avance && rangoEstado(avance) > rangoEstado(p.estado)
              ? { estado: avance }
              : {}),
          },
        }),
    });
  }

  const columnas: Columna<PedidoEnvio>[] = [
    {
      clave: "fecha",
      label: "Fecha",
      celda: (p) => {
        /* "Atrasado" es un reproche a quien empaca, así que solo se pinta si
           todavía hay algo que empacar. Ver hayTrabajo(). */
        const atrasado = esPedidoAtrasado(p.fecha, p.estado) && hayTrabajo(p);
        const plazo = plazoUrgente(p, ahora);
        const prep = preparacion(p);
        /* En "En camino" los días en la calle son la columna por la que se
           decide a quién llamarle, así que se enseñan todos; en las listas
           mezcladas, "salió ayer" solo sería ruido. */
        const transito = diasEnTransito(p, filtro === "en_camino" ? 0 : DIAS_TRANSITO_VISIBLE);
        const canal = obtenerCanal(p.canal)?.nombre ?? "la plataforma";
        const produccion = obtenerEstadoMaquila(enProduccion[p.id]);
        return (
          <div className="min-w-0">
            <span
              className={cn("inline-flex items-center gap-1", atrasado && "font-semibold text-red-600")}
            >
              {atrasado && <AlertTriangle className="size-3.5" aria-label="Atrasado" />}
              {formatearFecha(p.fecha)}
            </span>
            {/* Semáforo del plazo de despacho del canal: es el dato por el que
                se decide qué empacar primero, y vivía solo en el panel de ML. */}
            {plazo && (
              <span
                className="block"
                title={`Plazo de despacho de ${canal}: ${formatearFechaHora(p.envio_limite_despacho!)}`}
              >
                <Pastilla
                  nombre={SITUACION[plazo].nombre}
                  color={SITUACION[plazo].color}
                  className="mt-1 whitespace-nowrap px-1.5 py-0.5 text-[10.5px]"
                />
              </span>
            )}
            {/* Dónde está el paquete mientras no sale. "Por empacar" no se
                pinta: es el caso normal de un pendiente y llenaría la tabla de
                pastillas que no dicen nada. Lo que se anuncia es justo lo
                contrario —que aquí ya no hay nada que hacer—, porque es lo que
                explica que el pedido no esté en Urgentes. Por lo mismo tampoco
                se pinta dentro de la vista Full: ahí lo dice el rótulo de la
                tabla y las filas dirían todas lo mismo. */}
            {prep && !PREPARACION[prep].pendiente && filtro !== "full" && (
              <span
                className="block"
                title={
                  prep === "en_el_canal"
                    ? `${canal} lo despacha desde su centro: aquí no hay nada que empacar.`
                    : `Empacado y con la etiqueta puesta desde ${formatearFecha(p.fecha)}; falta que pase la recolección.`
                }
              >
                <Pastilla
                  nombre={PREPARACION[prep].nombre}
                  color={PREPARACION[prep].color}
                  className="mt-1 px-1.5 py-0.5 text-[10.5px]"
                />
              </span>
            )}
            {/* En qué va en el taller. Responde la pregunta que deja la tabla de
                personalizados —"¿y cuándo puedo empacar esto?"— sin salir a
                Maquila, que es donde se gestiona de verdad. */}
            {produccion && (
              <span className="block" title="Se fabrica antes de poder empacarse. Ver Maquila.">
                <Pastilla
                  nombre={produccion.nombre}
                  color={produccion.color}
                  className="mt-1 px-1.5 py-0.5 text-[10.5px]"
                />
              </span>
            )}
            {/* Ya salió: cuántos días lleva viajando. No es una alerta —informa,
                no alarma—, pero a partir del umbral se marca: son los que hay
                que ir a preguntar a la paquetería. */}
            {transito !== null && (
              <span
                className={cn(
                  "mt-1 block whitespace-nowrap text-[10.5px]",
                  transito >= DIAS_TRANSITO_VISIBLE
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground",
                )}
                title={
                  transito === 0
                    ? "Despachado hoy."
                    : `Despachado hace ${transito} días; la plataforma aún no confirma la entrega.`
                }
              >
                {transito === 0 ? "Salió hoy" : `En tránsito ${transito} d`}
              </span>
            )}
          </div>
        );
      },
    },
    {
      clave: "producto",
      label: "Producto",
      esTitulo: true,
      celda: (p) => (
        <div className="min-w-0">
          <div className="truncate font-medium" title={nombreVenta(p)}>
            <Resaltado texto={nombreVenta(p)} busca={busqueda} />
            {p.cantidad > 1 && <span className="ml-1 text-muted-foreground">×{p.cantidad}</span>}
          </div>
          {/* Nº de orden del canal: es el dato por el que pregunta el cliente, y
              el enlace lleva a esa misma orden en el panel de la plataforma
              (conversación con el comprador, factura, reclamos: lo que el CRM no
              replica). */}
          {p.referencia_externa &&
            (() => {
              const ref = numeroOrden(p.referencia_externa);
              const url = urlOrdenCanal(p.canal, ref, dominioTiendaNube, p.url_orden);
              const texto = `#${ref}`;
              return url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Abrir la orden en ${obtenerCanal(p.canal)?.nombre ?? "la plataforma"}`}
                  className="inline-flex max-w-full items-center gap-1 font-mono text-[11.5px] text-muted-foreground hover:text-foreground hover:underline"
                >
                  <span className="truncate">{texto}</span>
                  <ExternalLink className="size-3 shrink-0" />
                </a>
              ) : (
                <div className="truncate font-mono text-[11.5px] text-muted-foreground">{texto}</div>
              );
            })()}
        </div>
      ),
    },
    {
      clave: "cliente",
      label: "Cliente",
      celda: (p) => (
        <div className="truncate text-muted-foreground" title={p.cliente?.nombre ?? ""}>
          <Resaltado texto={p.cliente?.nombre ?? "—"} busca={busqueda} />
        </div>
      ),
    },
    {
      clave: "canal",
      label: "Canal",
      celda: (p) => {
        const canal = obtenerCanal(p.canal);
        return canal ? <Pastilla nombre={canal.nombre} color={canal.color} /> : null;
      },
    },
    {
      clave: "estado",
      label: "Estado",
      celda: (p) => (
        <Select
          value={p.estado ?? undefined}
          onValueChange={(v) => v && cambiar(p, v as EstadoPedidoId)}
        >
          <SelectTrigger className="h-auto w-fit gap-1 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0">
            {p.estado && <PastillaEstado estado={p.estado} />}
          </SelectTrigger>
          <SelectContent>
            {estadosQuePuedePoner.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
    {
      clave: "envio",
      label: "Envío",
      cardAncho: true,
      celda: (p) => {
        const rastreo = urlRastreo(p.paqueteria, p.num_guia, p.url_rastreo);
        const etiqueta = urlEtiquetaDirecta(p);
        const pendiente = p.estado === "nuevo" || p.estado === "preparando";
        const verPedido = pendiente ? urlVerPedido(p, dominioTiendaNube) : null;
        const nombreCanal = obtenerCanal(p.canal)?.nombre ?? "la plataforma";
        return (
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setEnvio(p)}
              className="min-w-0 flex-1 text-left text-xs text-muted-foreground hover:text-foreground"
              title={
                p.num_guia
                  ? `${p.paqueteria ?? "Guía"} ${p.num_guia}`
                  : "Ver/editar paquetería y guía"
              }
            >
              {p.num_guia ? (
                /* Paquetería arriba y guía abajo: en una sola línea no cabían y
                   la guía —lo que uno copia— era justo lo que se cortaba. */
                <span className="flex min-w-0 items-center gap-1">
                  <Truck className="size-3.5 shrink-0" />
                  <span className="min-w-0 leading-tight">
                    {p.paqueteria && <span className="block truncate">{p.paqueteria}</span>}
                    <span className="block truncate font-mono hover:underline">
                      <Resaltado texto={p.num_guia} busca={busqueda} />
                    </span>
                    {/* Lo último que dijo la paquetería. Es el dato por el que
                        había que salir del CRM: "Exception: empresa cerrada, sin
                        intento de entrega" explica en una línea por qué un
                        paquete se regresó. */}
                    {p.rastreo_detalle && (
                      <span
                        className="block truncate text-[11px] text-muted-foreground"
                        title={`${p.rastreo_estado ?? ""}${p.rastreo_en ? ` · consultado el ${formatearFechaHora(p.rastreo_en)}` : ""}`}
                      >
                        {p.rastreo_detalle}
                      </span>
                    )}
                  </span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-primary hover:underline">
                  <Truck className="size-3.5 shrink-0" />
                  Agregar guía
                </span>
              )}
            </button>
            {/* Dos acciones separadas mientras el pedido está por empacar:
                la impresora SOLO cuando el clic entrega la etiqueta de verdad
                (ML con id de envío), y "ver pedido" para abrir la orden en el
                panel del canal — que es donde se imprime cuando no hay PDF. */}
            {etiqueta && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  imprimirGuia(etiqueta);
                }}
                title="Imprimir la guía. OJO: Mercado Libre la da por impresa y el pedido pasa a «Listo para recolección»."
                aria-label="Imprimir la guía"
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Printer className="size-3.5" />
              </button>
            )}
            {verPedido && (
              <a
                href={verPedido}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={
                  etiqueta
                    ? `Ver el pedido en ${nombreCanal}`
                    : `Ver el pedido en ${nombreCanal} (ahí se imprime la guía)`
                }
                aria-label={`Ver el pedido en ${nombreCanal}`}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Eye className="size-3.5" />
              </a>
            )}
            {/* Atajo al rastreo de la paquetería: evita copiar la guía a mano en
                el sitio del transportista para saber dónde va el paquete. */}
            {rastreo && (
              <a
                href={rastreo}
                target="_blank"
                rel="noopener noreferrer"
                title={`Rastrear en ${p.paqueteria}`}
                aria-label={`Rastrear el envío en ${p.paqueteria}`}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      {/* Encabezado */}
      <div className="mb-5 flex flex-col gap-4 md:flex-row md:flex-wrap md:items-start md:justify-between">
        <div>
          <h1 className="text-[26px] font-bold tracking-[-0.5px]">Pedidos y envíos</h1>
          <p className="mt-1.5 text-[14.5px] text-muted-foreground">
            Qué hay que preparar y mandar, y qué se está atrasando. Los de Tienda Nube entran solos.
          </p>
        </div>
      </div>

      {/* KPIs: tres cifras, y las tres son de ESTA pantalla —lo que hay que
          empacar, lo que espera la colecta y lo que va en la calle—.

          Lo que NO lleva tarjeta, y en los tres casos a propósito:
            · Personalizados — se ven en su tabla, pero el número no manda aquí:
              quien mira esta pantalla decide qué empacar, y esas piezas las
              gobierna Maquila, que es donde se les pone fecha y se les empuja.
            · Full — no es trabajo de nadie de aquí; ocuparía un cuarto de la
              fila para decir "no hagas nada".
            · Urgentes — no es una categoría de pedidos sino un ATRIBUTO del
              trabajo de bodega, así que va como nota roja de la primera. */}
      <div className="mb-4 grid grid-cols-2 gap-3.5 lg:grid-cols-3">
        {/* Solo lo que se arma con lo que hay en el estante: los personalizados
            no se cuentan aquí porque no se pueden empacar todavía. */}
        <StatCard
          etiqueta="De bodega"
          valor={String(conteo.bandejas.por_empacar - conteo.personalizados)}
          icono={PackageCheck}
          nota={
            conteo.urgentesBodega > 0
              ? `${conteo.urgentesBodega} urgentes`
              : conteo.sinEmpezar > 0
                ? `${conteo.sinEmpezar} sin empezar`
                : undefined
          }
          notaClassName={conteo.urgentesBodega > 0 ? "font-semibold text-red-600" : undefined}
        />
        <StatCard
          etiqueta="Listos"
          valor={String(conteo.bandejas.listos)}
          icono={Clock}
          nota="esperando recolección"
        />
        <StatCard
          etiqueta="En camino"
          valor={String(conteo.bandejas.en_camino)}
          icono={Send}
          /* La única parte accionable: a esos hay que llamarle a la paquetería. */
          nota={
            conteo.enTransito > 0
              ? `${conteo.enTransito} llevan ${DIAS_TRANSITO_VISIBLE}+ días`
              : undefined
          }
        />
      </div>

      {/* El buscador salió del encabezado a su propio renglón: cuando llaman
          preguntando por un pedido, buscar por cliente o guía es lo primero que
          se hace, y ahí arriba competía de tamaño con dos selects y el
          segmentado. La barra además se queda pegada al bajar por la lista. */}
      <BarraHerramientas>
        <CampoBusqueda
          valor={busqueda}
          onCambio={setBusqueda}
          placeholder="Buscar cliente, guía o nº de orden…"
          conteo={{ visibles: visibles.length, total: pedidos.length, unidad: "pedidos" }}
        />
        <div className="flex w-full flex-wrap items-center gap-2">
          <Select
            value={filtroCanal}
            onValueChange={(v) => setFiltroCanal((v ?? "todos") as CanalId | "todos")}
          >
            <SelectTrigger className="w-full bg-card md:w-[185px]">
              <SelectValue>
                {(v: string) =>
                  v === "todos" ? "Todos los canales" : (obtenerCanal(v)?.nombre ?? "Canal")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los canales</SelectItem>
              {CANALES.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filtroEstado}
            onValueChange={(v) => {
              const e = (v ?? "todos") as EstadoPedidoId | "todos";
              setFiltroEstado(e);
              /* Entregados y cancelados no vienen en la carga inicial. */
              if (e !== "todos" && esEstadoTerminal(e)) void asegurarHistorico();
            }}
          >
            <SelectTrigger className="w-full bg-card md:w-[165px]">
              <SelectValue>
                {(v: string) =>
                  v === "todos" ? "Todos los estados" : (obtenerEstadoPedido(v)?.nombre ?? "Estado")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los estados</SelectItem>
              {ESTADOS_PEDIDO.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Móvil: selector. Escritorio: segmentado. Con seis vistas ya no
              caben seis botones en el ancho del teléfono —a 390 px tocan a 60 px
              y "Por empacar" se partía en dos renglones—. Mismo patrón que
              Clientes. El histórico se pide la primera vez que hace falta, y por
              eso los dos controles llaman a `cambiarVista`: ninguna de las cinco
              vistas restantes lo necesita, solo "Todos". */}
          <Select value={filtro} onValueChange={(v) => v && cambiarVista(v as Vista)}>
            <SelectTrigger className="w-full bg-card md:hidden">
              <SelectValue>
                {(v: string) => {
                  const vista = VISTAS.find((x) => x.id === v);
                  const n = numeroDeVista(v as Vista);
                  return `Vista: ${vista?.label ?? "—"}${n !== null ? ` (${n})` : ""}`;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {VISTAS.map((v) => {
                const n = numeroDeVista(v.id);
                return (
                  <SelectItem key={v.id} value={v.id}>
                    {v.label}
                    {n !== null ? ` (${n})` : ""}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>

          <div className="hidden rounded-xl bg-muted p-[3px] md:inline-flex">
            {VISTAS.map((v) => {
              const n = numeroDeVista(v.id);
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => cambiarVista(v.id)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors",
                    filtro === v.id
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {v.label}
                  {/* El número al lado: es lo que evita entrar a una pestaña
                      para descubrir que está vacía. */}
                  {n !== null && (
                    <span className="ml-1.5 text-[11.5px] font-semibold tabular-nums text-muted-foreground">
                      {n}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Cómo se ve «Por empacar». Solo aparece ahí: en las demás vistas no
              hay ninguna caja que mover, y un control que no hace nada confunde
              más de lo que ayuda. */}
          {hayTablero && (
            <ControlSegmentado
              opciones={
                [
                  ["tablero", "Tablero"],
                  ["tabla", "Tabla"],
                ] as const
              }
              valor={modo}
              onCambio={setModo}
              className="ml-auto"
            />
          )}
        </div>
      </BarraHerramientas>

      {/* La mesa de empaque. Sustituye SOLO a la tabla de bodega: la de
          personalizados de abajo se queda igual en los dos modos, porque esas
          piezas no se empacan —todavía no existen— y no tienen sitio en ninguna
          de las cuatro columnas. */}
      {hayTablero && modo === "tablero" ? (
        <TableroEmpaque
          pedidos={enTablero}
          ahora={ahora}
          onMover={moverEtapa}
          onAbrir={(p) => setEnvio(p)}
          dominioTiendaNube={dominioTiendaNube}
        />
      ) : (
        <TablaSimple
          cols={COLS}
          columnas={columnas}
          datos={enBodega}
          filaKey={(p) => p.id}
          minW="min-w-[900px]"
          onRowClick={(p) => setEnvio(p)}
          filaClassName={(p) => (esUrgente(p, ahora) ? "bg-red-50/50 dark:bg-red-950/20" : "")}
          /* De quién es el trabajo, dicho una vez arriba de la lista en las
             vistas donde la respuesta no es "de la bodega". En las demás sobra. */
          titulo={
            filtro === "full"
              ? "Los prepara y despacha Mercado Libre desde su centro"
              : filtro === "en_camino"
                ? "Ya salieron de aquí · lo más viejo primero"
                : enTaller.length > 0
                  ? "De bodega · se arman con lo que hay en el estante"
                  : undefined
          }
          vacio={
            cargandoHistorico
              ? "Cargando el histórico…"
              : filtroEstado !== "todos"
                ? `Ningún pedido en "${obtenerEstadoPedido(filtroEstado)?.nombre ?? filtroEstado}".`
                : /* Si lo único que queda son personalizados, decirlo: una tabla
                     vacía arriba y otra llena abajo, sin explicación, parece un
                     error de la pantalla. */
                  enTaller.length > 0
                  ? filtro === "urgentes"
                    ? "Nada urgente de bodega: lo que corre prisa está en el taller."
                    : "Nada que empacar de bodega: lo que queda son personalizados."
                  : vistaActual.vacio
          }
        />
      )}

      {/* Los personalizados, aparte. No se empacan: se fabrican primero, y
          mezclarlos con el resto hacía que la lista de "lo que hay que armar
          hoy" incluyera piezas que todavía no existen. El estado de cada una
          vive en el tablero de Maquila; aquí solo se dice en qué va. */}
      {enTaller.length > 0 && (
        <div className="mt-6">
          <TablaSimple
            cols={COLS}
            columnas={columnas}
            datos={enTaller}
            filaKey={(p) => p.id}
            minW="min-w-[900px]"
            onRowClick={(p) => setEnvio(p)}
            /* Mismo rojo que arriba: que la pieza la haga el taller no quita que
               el plazo con el cliente se esté pasando — solo cambia a quién hay
               que ir a buscar. */
            filaClassName={(p) => (esUrgente(p, ahora) ? "bg-red-50/50 dark:bg-red-950/20" : "")}
            titulo={`Personalizados · ${enTaller.length} — los fabrica el taller antes de poder empacarse`}
            vacio="Ningún personalizado pendiente."
          />
        </div>
      )}

      {envio && (
        <EnvioDialog
          pedido={envio}
          gestor={gestor}
          onClose={() => setEnvio(null)}
        />
      )}
    </div>
  );
}
