#!/usr/bin/env bash
# Copia los DATOS de la base de producción a otro entorno del CRM.
#
# Para qué: quien trabaja solo en la interfaz necesita ver las pantallas con
# volumen real —cien pedidos, el catálogo completo— o no puede juzgar si un
# diseño aguanta. Un entorno recién creado trae el esquema de las migraciones
# pero está vacío, y una tabla vacía se ve bien siempre.
#
# Qué NO copia: el esquema `auth`. Los usuarios de login se dan de alta en el
# destino con `scripts/crear-usuario.mjs`, que es idempotente y así ninguna
# contraseña de producción sale de producción. Los perfiles del equipo sí se
# copian —hacen falta para que las pantallas se vean pobladas— y quedan sin
# usuario de Auth detrás, que es justo lo que se busca: nadie puede entrar con
# ellos.
#
# Usa `pg_dump` y no `supabase db dump` a propósito: el segundo levanta un
# contenedor para garantizar la versión exacta de Postgres, y exigir Docker
# para copiar unas tablas no se paga solo.
#
# Uso:
#   ORIGEN="postgresql://…" DESTINO="postgresql://…" \
#     bash scripts/clonar-datos-a-entorno.sh
#
# Las dos cadenas salen del panel de Supabase (Project Settings → Database →
# Connection string, en modo URI). Van por variable de entorno y no como
# argumento para que la contraseña no quede en el historial de la terminal.

set -euo pipefail

: "${ORIGEN:?falta ORIGEN (la base de la que se lee)}"
: "${DESTINO:?falta DESTINO (la base en la que se escribe)}"

command -v pg_dump >/dev/null || { echo "✗ falta pg_dump (brew install postgresql@17)" >&2; exit 1; }
command -v psql    >/dev/null || { echo "✗ falta psql (brew install postgresql@17)" >&2; exit 1; }

# El error que este script no puede cometer nunca es escribir en producción.
# Se compara usuario+host y no solo el host: dos proyectos de la misma región
# comparten el host del pooler, y ahí lo que los distingue es el usuario, que
# lleva dentro el ref del proyecto (postgres.<ref>). Comparando solo el host,
# copiar entre dos proyectos vecinos abortaría sin motivo.
host_de()     { node -e 'console.log(new URL(process.argv[1]).host)' "$1"; }
identidad_de() { node -e 'const u=new URL(process.argv[1]); console.log(u.username+"@"+u.host)' "$1"; }
if [ "$(identidad_de "$ORIGEN")" = "$(identidad_de "$DESTINO")" ]; then
  echo "✗ ORIGEN y DESTINO son la misma base. No se hace nada." >&2
  exit 1
fi

VOLCADO="$(mktemp -t datos-crm)"
trap 'rm -f "$VOLCADO"' EXIT

# Varias migraciones siembran filas (las empresas de la agencia, catálogos), así
# que un destino "recién creado" ya trae datos que chocan con los de producción.
# Vaciar es destructivo, así que se pide a mano con VACIAR=1 en vez de pasar
# siempre: quien apunte DESTINO a una base que sí importa no pierde nada por
# olvido. El TRUNCATE va en una sola sentencia con todas las tablas porque
# hacerlo tabla por tabla exigiría acertar el orden de las dependencias.
if [ "${VACIAR:-0}" = "1" ]; then
  echo "· vaciando las tablas de $(host_de "$DESTINO")…"
  psql "$DESTINO" --quiet --set ON_ERROR_STOP=on --command "
    DO \$\$
    DECLARE lista text;
    BEGIN
      SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
        INTO lista FROM pg_tables WHERE schemaname = 'public';
      IF lista IS NOT NULL THEN
        EXECUTE 'TRUNCATE TABLE ' || lista || ' RESTART IDENTITY CASCADE';
      END IF;
    END \$\$;"
fi

echo "· leyendo los datos de $(host_de "$ORIGEN")…"
pg_dump "$ORIGEN" --data-only --schema=public --no-owner --no-privileges -f "$VOLCADO"
echo "  $(du -h "$VOLCADO" | cut -f1) de datos"

echo "· escribiendo en $(host_de "$DESTINO")…"
# `session_replication_role = replica` apaga las llaves foráneas y los triggers
# mientras dura la carga. Sin esto el volcado falla en cuanto una tabla llega
# antes que aquella a la que apunta, y el orden correcto de 87 tablas no es
# algo que se pueda adivinar. Va en el mismo --single-transaction que el
# volcado para que el ajuste muera con la sesión.
psql "$DESTINO" --quiet --single-transaction --set ON_ERROR_STOP=on \
  --command 'SET session_replication_role = replica;' \
  --file "$VOLCADO"

echo "✓ datos copiados. Falta dar de alta a quien va a entrar:"
echo "    node --env-file=<env-del-destino> scripts/crear-usuario.mjs --email … --nombre … --rol … --password …"
