/* ============================================================================
   lib/maquila/consignacion.ts — Qué material gasta cada pedido
   ----------------------------------------------------------------------------
   Funciones PURAS, sin imports de datos, como lib/maquila/reglas.ts.

   Esta regla vive DOS VECES a propósito: aquí y en el trigger
   consumir_insumos_maquila (20260927000100). El trigger es el que manda —el
   descuento tiene que pasar aunque nadie abra el navegador—, pero la pantalla
   necesita poder decir «este pedido se va a llevar 1 palanca negra» ANTES de
   que salga, y para eso no sirve una función de Postgres.

   Es la misma duplicación consciente que `esVendible`/`estaCancelada` en
   lib/maquila/ingesta.ts. Si cambia una, cambia la otra: las claves
   ('palanca_negra', 'munequeras', 'straps') son el contrato entre las dos.
   ============================================================================ */

/* Cuánto material de consignación consume un renglón al salir. Devuelve las
   claves de maquila_insumos con su cantidad, ya multiplicadas por las piezas
   del renglón.

   Palanca sin color definido NO consume nada: si nadie sabe cuál lleva,
   tampoco se puede descontar cuál — es coherente con que la ficha imprimible
   grite «SIN DEFINIR» en vez de adivinar. */
export function insumosDePedido(p: {
  requiere_palanca: boolean;
  palanca_color: string | null;
  combo: string;
  cantidad: number;
}): { clave: string; cantidad: number }[] {
  const n = Math.max(1, p.cantidad || 1);
  const out: { clave: string; cantidad: number }[] = [];

  if (p.requiere_palanca && p.palanca_color) {
    out.push({ clave: `palanca_${p.palanca_color}`, cantidad: n });
  }
  if (p.combo === "munequeras" || p.combo === "ambos") {
    out.push({ clave: "munequeras", cantidad: n });
  }
  if (p.combo === "straps" || p.combo === "ambos") {
    out.push({ clave: "straps", cantidad: n });
  }
  return out;
}

/* Lo que se va a gastar de aquí en adelante: la suma de todos los pedidos que
   siguen vivos y todavía no han salido. Es lo que convierte «tiene 30
   palancas» en «tiene 30 y ya están comprometidas 12». */
export function comprometidoPorInsumo(
  pedidos: {
    estado: string;
    enviado_en: string | null;
    requiere_palanca: boolean;
    palanca_color: string | null;
    combo: string;
    cantidad: number;
  }[],
): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const p of pedidos) {
    if (p.enviado_en) continue; // ya salió: su consumo está en el saldo
    if (["cancelado", "devuelto", "esperando_pago"].includes(p.estado)) continue;
    for (const { clave, cantidad } of insumosDePedido(p)) {
      mapa.set(clave, (mapa.get(clave) ?? 0) + cantidad);
    }
  }
  return mapa;
}
