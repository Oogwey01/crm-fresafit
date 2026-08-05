/* ============================================================================
   lib/facturas/extraer.ts  —  Leer la factura del proveedor con IA
   ----------------------------------------------------------------------------
   René lo pidió en la junta: que en vez de recapturar renglón por renglón la
   factura del proveedor extranjero (en dólares o en pesos), el sistema la lea.
   Esto NO guarda nada: devuelve los renglones para que el usuario los revise en
   la vista previa y decida. La IA solo rellena.
   ============================================================================ */

import Anthropic from "@anthropic-ai/sdk";

/* Lo que se le pide a la IA que saque de la factura. El esquema es estricto
   (`additionalProperties: false`) para que la respuesta se pueda leer sin
   defenderse de campos inventados. */
const ESQUEMA = {
  type: "object",
  properties: {
    proveedor: {
      type: ["string", "null"],
      description: "Nombre del proveedor que emite la factura, tal como aparece.",
    },
    folio: {
      type: ["string", "null"],
      description: "Número o folio de la factura.",
    },
    fecha: {
      type: ["string", "null"],
      description: "Fecha de la factura en formato AAAA-MM-DD.",
    },
    moneda: {
      type: "string",
      enum: ["USD", "MXN", "OTRA"],
      description: "Moneda de los importes.",
    },
    tipo_cambio: {
      type: ["number", "null"],
      description: "Tipo de cambio a pesos si la factura lo indica; si no, null.",
    },
    total: {
      type: ["number", "null"],
      description: "Total de la factura.",
    },
    renglones: {
      type: "array",
      description: "Un renglón por partida de la factura.",
      items: {
        type: "object",
        properties: {
          descripcion: { type: "string", description: "Descripción de la partida." },
          sku: {
            type: ["string", "null"],
            description: "Código o SKU del proveedor si aparece.",
          },
          cantidad: { type: "number", description: "Piezas de esa partida." },
          costo_unitario: {
            type: ["number", "null"],
            description: "Precio unitario en la moneda de la factura.",
          },
        },
        required: ["descripcion", "sku", "cantidad", "costo_unitario"],
        additionalProperties: false,
      },
    },
  },
  required: ["proveedor", "folio", "fecha", "moneda", "tipo_cambio", "total", "renglones"],
  additionalProperties: false,
} as const;

export type FacturaExtraida = {
  proveedor: string | null;
  folio: string | null;
  fecha: string | null;
  moneda: "USD" | "MXN" | "OTRA";
  tipo_cambio: number | null;
  total: number | null;
  renglones: {
    descripcion: string;
    sku: string | null;
    cantidad: number;
    costo_unitario: number | null;
  }[];
};

const INSTRUCCIONES = `Eres el asistente de compras de Fresafit, una marca mexicana de accesorios
de gimnasio (cinturones, muñequeras, straps, ropa). Te van a pasar la factura de un proveedor,
normalmente chino y en dólares, a veces en pesos.

Saca las partidas tal como están: no las agrupes, no las traduzcas y no inventes datos.
Si un dato no aparece en el documento, déjalo en null en vez de deducirlo.
Los importes van como número, sin símbolo de moneda ni separadores de millar.
Si la cantidad de una partida no se lee, ponla en 1 y deja el costo en null para que
quien revise lo note.`;

/* Tipos de archivo que el modelo puede leer. */
const TIPOS_IMAGEN = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

export type ResultadoExtraccion =
  | { ok: true; datos: FacturaExtraida }
  | { error: string };

/* Manda la factura al modelo y devuelve las partidas. El archivo viaja en
   base64: son documentos de pocas páginas y así no hace falta subirlo antes a
   ningún lado. */
export async function extraerFacturaConIA(
  archivo: File,
): Promise<ResultadoExtraccion> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      error:
        "Falta la variable ANTHROPIC_API_KEY. Configúrala en Vercel para poder leer facturas.",
    };
  }

  const tipo = archivo.type;
  const esPdf = tipo === "application/pdf";
  const esImagen = (TIPOS_IMAGEN as readonly string[]).includes(tipo);
  if (!esPdf && !esImagen) {
    return { error: "La factura tiene que ser un PDF o una foto (JPG, PNG o WebP)." };
  }

  const base64 = Buffer.from(await archivo.arrayBuffer()).toString("base64");
  const documento = esPdf
    ? ({
        type: "document" as const,
        source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64 },
      })
    : ({
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: tipo as (typeof TIPOS_IMAGEN)[number],
          data: base64,
        },
      });

  const cliente = new Anthropic({ apiKey });

  try {
    const respuesta = await cliente.messages.create({
      model: "claude-opus-5",
      max_tokens: 16000,
      system: INSTRUCCIONES,
      output_config: { format: { type: "json_schema", schema: ESQUEMA } },
      messages: [
        {
          role: "user",
          content: [
            documento,
            { type: "text", text: "Extrae las partidas de esta factura." },
          ],
        },
      ],
    });

    /* Una negativa del modelo llega como respuesta exitosa con este motivo: hay
       que revisarla antes de leer el contenido. */
    if (respuesta.stop_reason === "refusal") {
      return { error: "El modelo no quiso procesar este documento. Captura la factura a mano." };
    }
    if (respuesta.stop_reason === "max_tokens") {
      return {
        error:
          "La factura es demasiado larga para leerla de una vez. Prueba con las páginas por separado.",
      };
    }

    const texto = respuesta.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (!texto.trim()) return { error: "El modelo no devolvió nada legible." };

    const datos = JSON.parse(texto) as FacturaExtraida;
    if (!Array.isArray(datos.renglones) || datos.renglones.length === 0) {
      return { error: "No se reconoció ninguna partida en el documento." };
    }
    return { ok: true, datos };
  } catch (e) {
    /* Si algo falla —red, cuota, un PDF ilegible— el usuario siempre puede
       capturar el pedido a mano: esto solo prellena. */
    const mensaje = e instanceof Error ? e.message : "No se pudo leer la factura.";
    return { error: `No se pudo leer la factura: ${mensaje}` };
  }
}
