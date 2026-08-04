import { NextResponse } from "next/server";
import { usuarioActual, esInterno } from "@/lib/supabase/usuario-actual";
import {
  conexionTiktok,
  elegirShopTikTok,
  guardarConexionTikTok,
  guardarWarehouseTikTok,
  intercambiarCodigoTikTok,
  listarWarehousesTikTok,
  obtenerShopsTikTok,
} from "@/lib/tiktok/api";
import { importacionCompletaTikTok } from "@/lib/tiktok/sync";

/* Callback del OAuth de TikTok Shop: cambia el código por los tokens, obtiene
   el shop_cipher (llave de todas las llamadas) y el almacén principal (para
   escribir stock), guarda la conexión e importa el catálogo. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const { user, rol } = await usuarioActual();
  if (!user || !esInterno(rol)) return NextResponse.redirect(`${origin}/login`);

  const code = searchParams.get("code");
  if (!code) return NextResponse.redirect(`${origin}/inventario?tiktok=error`);

  try {
    const tokens = await intercambiarCodigoTikTok(code);
    const shops = await obtenerShopsTikTok(tokens.access_token);

    /* La cuenta trae también una tienda SANDBOX, y quedarse con la primera de
       la lista podía apuntar el CRM al catálogo de pruebas y apagar la
       integración real sin aviso. Se conserva la tienda ya conectada. */
    const yaConectada = await conexionTiktok().catch(() => null);
    const shop = elegirShopTikTok(shops, yaConectada?.shopId);
    if (!shop?.cipher) throw new Error("TikTok Shop no devolvió ninguna tienda autorizada.");
    if (yaConectada?.shopId && shop.id !== yaConectada.shopId) {
      /* Cambiar de tienda borra el vínculo con todo el catálogo importado, así
         que no se hace en silencio: se rechaza y se avisa. */
      console.error(
        `[tiktok] la autorización es de la tienda ${shop.id} (${shop.name ?? "sin nombre"}) ` +
          `y el CRM está conectado a ${yaConectada.shopId}; no se cambia.`,
      );
      return NextResponse.redirect(`${origin}/inventario?tiktok=otra-tienda`);
    }
    await guardarConexionTikTok(tokens, { cipher: shop.cipher, id: shop.id });

    // Almacén principal (para poder escribir stock después). No es fatal: el
    // catálogo se importa igual; sin almacén solo se pospone el empuje de stock.
    const cx = await conexionTiktok();
    if (cx) {
      try {
        const warehouses = await listarWarehousesTikTok(cx);
        if (warehouses[0]?.id) await guardarWarehouseTikTok(warehouses[0].id);
      } catch (e) {
        console.error("[tiktok] almacenes:", e);
      }
    }

    // Se reutiliza la conexión ya leída para ahorrar la relectura interna. Que
    // `cx` sea anterior al guardado del warehouse no importa: la importación es
    // solo lectura (token + shop_cipher) y no usa warehouseId. Si `cx` vino
    // null, la función relee (y falla) igual que antes.
    const resumen = await importacionCompletaTikTok(cx ?? undefined);
    return NextResponse.redirect(
      `${origin}/inventario?tiktok=conectada&productos=${resumen.productos}&vinculados=${resumen.vinculados}`,
    );
  } catch (e) {
    console.error("[tiktok] callback:", e);
    return NextResponse.redirect(`${origin}/inventario?tiktok=error`);
  }
}
