#!/usr/bin/env bash
# Regenera lib/supabase/tipos-bd.ts desde el esquema real de Supabase.
#
# Existe como script y no como una línea en package.json por dos motivos:
#
# 1. La redirección directa (`supabase gen types … > archivo`) TRUNCA el archivo
#    antes de ejecutar el comando. Si no hay red, el token caducó o el proyecto
#    no está vinculado, el resultado es un tipos-bd.ts VACÍO y el proyecto deja
#    de compilar entero — por un fallo que no tiene nada que ver con el código.
#    Aquí se genera a un temporal, se comprueba que trae lo que debe, y solo
#    entonces se reemplaza.
#
# 2. Corre solo en la máquina de quien desarrolla. En Vercel no hay CLI de
#    Supabase ni credenciales, así que se sale en silencio: el archivo commiteado
#    es el que manda en el deploy.

set -uo pipefail

DESTINO="lib/supabase/tipos-bd.ts"

# En el build de Vercel/CI no hay nada que regenerar.
if [ -n "${VERCEL:-}" ] || [ -n "${CI:-}" ]; then
  exit 0
fi

if ! command -v supabase >/dev/null 2>&1; then
  echo "· tipos: falta el CLI de Supabase; se usa el $DESTINO commiteado."
  exit 0
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

if ! supabase gen types typescript --linked --schema public >"$TMP" 2>/dev/null; then
  # `--linked` habla con la API de Supabase y necesita el token de
  # `supabase login`, que caduca y no existe en una máquina recién clonada. La
  # contraseña de la base sí está en .env.local, así que se reintenta por
  # conexión directa antes de darse por vencido: sin esto el archivo se queda
  # describiendo el esquema de ayer y el compilador deja pasar columnas que ya
  # no existen.
  CLAVE="${SUPABASE_DB_PASSWORD:-}"
  if [ -z "$CLAVE" ] && [ -f .env.local ]; then
    CLAVE="$(node --env-file=.env.local -p 'process.env.SUPABASE_DB_PASSWORD || ""' 2>/dev/null)"
  fi

  # El host del pooler (con su región) lo deja `supabase link` en .temp.
  POOLER="supabase/.temp/pooler-url"

  if [ -n "$CLAVE" ] && [ -f "$POOLER" ]; then
    DB_URL="$(CLAVE="$CLAVE" node -e '
      const fs = require("fs");
      const url = new URL(fs.readFileSync(process.argv[1], "utf8").trim());
      url.password = process.env.CLAVE;
      console.log(url.toString());
    ' "$POOLER" 2>/dev/null)"
  fi

  if [ -z "${DB_URL:-}" ] || ! supabase gen types typescript --db-url "$DB_URL" --schema public >"$TMP" 2>/dev/null; then
    echo "· tipos: no se pudo consultar Supabase (¿sin red, sin 'supabase login'"
    echo "  y sin SUPABASE_DB_PASSWORD en .env.local?)."
    echo "  Se usa el $DESTINO que ya está en el repo."
    exit 0
  fi
fi

# Un archivo sin el tipo raíz es un archivo inservible, venga como venga.
if ! grep -q "export type Database" "$TMP"; then
  echo "· tipos: la respuesta de Supabase no trae 'Database'; no se toca $DESTINO."
  exit 0
fi

if [ -f "$DESTINO" ] && cmp -s "$TMP" "$DESTINO"; then
  exit 0
fi

cp "$TMP" "$DESTINO"
echo "· tipos: $DESTINO actualizado desde el esquema en vivo."
