/* ============================================================================
   lib/canales/direccion.ts — Dirección de envío normalizada
   ----------------------------------------------------------------------------
   Las tres plataformas mandan la dirección con nombres de campo distintos
   (Tienda Nube: address/number/locality; Mercado Libre: street_name/city.name;
   TikTok: la agrega en district_info + detail_address). Aquí se traducen todas
   a la misma forma para que la UI no tenga que saber de qué canal viene.

   Lo que no encaja en ningún campo conocido se descarta a propósito: guardar
   restos con la forma de cada API convertiría el jsonb en otro formato distinto
   por canal, que es justo lo que esto viene a evitar.
   ============================================================================ */

export type DireccionEnvio = {
  nombre?: string | null;
  telefono?: string | null;
  calle?: string | null;
  numero?: string | null;
  colonia?: string | null;
  ciudad?: string | null;
  estado?: string | null;
  cp?: string | null;
  pais?: string | null;
  referencias?: string | null;
};

function limpio(v: unknown): string | null {
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

/* Devuelve la dirección o null si no llegó NADA útil: una fila con todos los
   campos vacíos se lee como "sí hay dirección" y no la hay. */
export function normalizarDireccion(d: DireccionEnvio): DireccionEnvio | null {
  const limpia: DireccionEnvio = {
    nombre: limpio(d.nombre),
    telefono: limpio(d.telefono),
    calle: limpio(d.calle),
    numero: limpio(d.numero),
    colonia: limpio(d.colonia),
    ciudad: limpio(d.ciudad),
    estado: limpio(d.estado),
    cp: limpio(d.cp),
    pais: limpio(d.pais),
    referencias: limpio(d.referencias),
  };
  return Object.values(limpia).some((v) => v !== null) ? limpia : null;
}

/* Una línea legible para la tabla de pedidos ("Calle 123, Col. Centro, …"). */
export function direccionEnUnaLinea(d: DireccionEnvio | null): string {
  if (!d) return "";
  const calle = [d.calle, d.numero].filter(Boolean).join(" ");
  return [calle, d.colonia, d.ciudad, d.estado, d.cp].filter(Boolean).join(", ");
}
