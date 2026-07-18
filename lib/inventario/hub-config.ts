/* ============================================================================
   lib/inventario/hub-config.ts — Interruptor del hub de stock por ventas
   ----------------------------------------------------------------------------
   Modelo padre-hijo: Tienda Nube es el inventario padre; una venta en un canal
   hijo (Mercado Libre, y en el futuro TikTok) descuenta el stock del CRM y lo
   empuja a los demás canales. Ese comportamiento vive detrás de este flag.

   APAGADO por defecto (variable no definida) → el sistema se comporta igual que
   antes: sin descuento por venta y con la adopción de stock de ML intacta. Toda
   la infraestructura (RPC descontar_stock_ventas, tipos del hub) queda inerte.

   Para ACTIVARLO: definir STOCK_HUB_VENTAS=on en el entorno (Vercel) y redeploy.
   ============================================================================ */

export const HUB_VENTAS_ACTIVO = process.env.STOCK_HUB_VENTAS === "on";
