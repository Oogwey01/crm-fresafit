export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      actividad_empresas: {
        Row: {
          accion: string
          actor_id: string | null
          actor_nombre: string | null
          created_at: string
          detalle: Json | null
          empresa_id: string | null
          entidad: string | null
          entidad_id: string | null
          id: number
        }
        Insert: {
          accion: string
          actor_id?: string | null
          actor_nombre?: string | null
          created_at?: string
          detalle?: Json | null
          empresa_id?: string | null
          entidad?: string | null
          entidad_id?: string | null
          id?: never
        }
        Update: {
          accion?: string
          actor_id?: string | null
          actor_nombre?: string | null
          created_at?: string
          detalle?: Json | null
          empresa_id?: string | null
          entidad?: string | null
          entidad_id?: string | null
          id?: never
        }
        Relationships: [
          {
            foreignKeyName: "actividad_empresas_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actividad_empresas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agencia_empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      agencia_asignaciones: {
        Row: {
          activo: boolean
          created_at: string
          empresa_id: string
          id: string
          papel: string | null
          profile_id: string
        }
        Insert: {
          activo?: boolean
          created_at?: string
          empresa_id: string
          id?: string
          papel?: string | null
          profile_id: string
        }
        Update: {
          activo?: boolean
          created_at?: string
          empresa_id?: string
          id?: string
          papel?: string | null
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agencia_asignaciones_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agencia_empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agencia_asignaciones_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agencia_contratos: {
        Row: {
          activo: boolean
          base_calculo: string
          created_at: string
          dia_corte: number
          empresa_id: string
          fin: string | null
          fondo_delegado: number
          id: string
          inicio: string | null
          moneda: string
          monto_fijo: number
          nombre: string
          notas: string | null
          periodicidad: string
          plataforma: string
          porcentaje: number
          updated_at: string | null
        }
        Insert: {
          activo?: boolean
          base_calculo?: string
          created_at?: string
          dia_corte?: number
          empresa_id: string
          fin?: string | null
          fondo_delegado?: number
          id?: string
          inicio?: string | null
          moneda?: string
          monto_fijo?: number
          nombre?: string
          notas?: string | null
          periodicidad?: string
          plataforma?: string
          porcentaje?: number
          updated_at?: string | null
        }
        Update: {
          activo?: boolean
          base_calculo?: string
          created_at?: string
          dia_corte?: number
          empresa_id?: string
          fin?: string | null
          fondo_delegado?: number
          id?: string
          inicio?: string | null
          moneda?: string
          monto_fijo?: number
          nombre?: string
          notas?: string | null
          periodicidad?: string
          plataforma?: string
          porcentaje?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agencia_contratos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agencia_empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      agencia_empresas: {
        Row: {
          activa: boolean
          color: string
          contacto_correo: string | null
          contacto_nombre: string | null
          contacto_telefono: string | null
          created_at: string
          created_by: string | null
          giro: string | null
          id: string
          inicio: string | null
          nombre: string
          notas: string | null
          slug: string
          updated_at: string | null
        }
        Insert: {
          activa?: boolean
          color?: string
          contacto_correo?: string | null
          contacto_nombre?: string | null
          contacto_telefono?: string | null
          created_at?: string
          created_by?: string | null
          giro?: string | null
          id?: string
          inicio?: string | null
          nombre: string
          notas?: string | null
          slug: string
          updated_at?: string | null
        }
        Update: {
          activa?: boolean
          color?: string
          contacto_correo?: string | null
          contacto_nombre?: string | null
          contacto_telefono?: string | null
          created_at?: string
          created_by?: string | null
          giro?: string | null
          id?: string
          inicio?: string | null
          nombre?: string
          notas?: string | null
          slug?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agencia_empresas_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agencia_ingresos: {
        Row: {
          cobrado_at: string | null
          concepto: string
          contrato_id: string | null
          created_at: string
          created_by: string | null
          empresa_id: string | null
          estado: string
          factura: string | null
          fondo_delegado: number
          id: string
          monto_fijo: number
          monto_variable: number
          notas: string | null
          pagado_at: string | null
          periodo_desde: string | null
          periodo_hasta: string | null
          porcentaje: number
          socio: string | null
          tipo: string
          total: number
          updated_at: string | null
          ventas_base: number
          ventas_nota: string | null
          ventas_origen: string
        }
        Insert: {
          cobrado_at?: string | null
          concepto: string
          contrato_id?: string | null
          created_at?: string
          created_by?: string | null
          empresa_id?: string | null
          estado?: string
          factura?: string | null
          fondo_delegado?: number
          id?: string
          monto_fijo?: number
          monto_variable?: number
          notas?: string | null
          pagado_at?: string | null
          periodo_desde?: string | null
          periodo_hasta?: string | null
          porcentaje?: number
          socio?: string | null
          tipo?: string
          total?: number
          updated_at?: string | null
          ventas_base?: number
          ventas_nota?: string | null
          ventas_origen?: string
        }
        Update: {
          cobrado_at?: string | null
          concepto?: string
          contrato_id?: string | null
          created_at?: string
          created_by?: string | null
          empresa_id?: string | null
          estado?: string
          factura?: string | null
          fondo_delegado?: number
          id?: string
          monto_fijo?: number
          monto_variable?: number
          notas?: string | null
          pagado_at?: string | null
          periodo_desde?: string | null
          periodo_hasta?: string | null
          porcentaje?: number
          socio?: string | null
          tipo?: string
          total?: number
          updated_at?: string | null
          ventas_base?: number
          ventas_nota?: string | null
          ventas_origen?: string
        }
        Relationships: [
          {
            foreignKeyName: "agencia_ingresos_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "agencia_contratos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agencia_ingresos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agencia_ingresos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agencia_empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      conjunto_armados: {
        Row: {
          cantidad: number
          conjunto_id: string | null
          created_at: string
          created_by: string | null
          detalle: Json
          id: string
          lote: string
          nota: string | null
          producto_id: string | null
          revierte_a: string | null
          sku_conjunto: string
          subido_en: string | null
          subido_por: string | null
          tipo: string
        }
        Insert: {
          cantidad: number
          conjunto_id?: string | null
          created_at?: string
          created_by?: string | null
          detalle?: Json
          id?: string
          lote: string
          nota?: string | null
          producto_id?: string | null
          revierte_a?: string | null
          sku_conjunto: string
          subido_en?: string | null
          subido_por?: string | null
          tipo: string
        }
        Update: {
          cantidad?: number
          conjunto_id?: string | null
          created_at?: string
          created_by?: string | null
          detalle?: Json
          id?: string
          lote?: string
          nota?: string | null
          producto_id?: string | null
          revierte_a?: string | null
          sku_conjunto?: string
          subido_en?: string | null
          subido_por?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "conjunto_armados_conjunto_id_fkey"
            columns: ["conjunto_id"]
            isOneToOne: false
            referencedRelation: "conjuntos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conjunto_armados_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conjunto_armados_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "producto_costos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conjunto_armados_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conjunto_armados_revierte_a_fkey"
            columns: ["revierte_a"]
            isOneToOne: false
            referencedRelation: "conjunto_armados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conjunto_armados_subido_por_fkey"
            columns: ["subido_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conjunto_componentes: {
        Row: {
          cantidad: number
          conjunto_id: string
          id: string
          producto_id: string | null
          rol: string | null
          sku_componente: string
        }
        Insert: {
          cantidad?: number
          conjunto_id: string
          id?: string
          producto_id?: string | null
          rol?: string | null
          sku_componente: string
        }
        Update: {
          cantidad?: number
          conjunto_id?: string
          id?: string
          producto_id?: string | null
          rol?: string | null
          sku_componente?: string
        }
        Relationships: [
          {
            foreignKeyName: "conjunto_componentes_conjunto_id_fkey"
            columns: ["conjunto_id"]
            isOneToOne: false
            referencedRelation: "conjuntos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conjunto_componentes_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "producto_costos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conjunto_componentes_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      conjuntos: {
        Row: {
          activo: boolean
          categoria: string | null
          created_at: string
          created_by: string | null
          id: string
          notas: string | null
          producto_id: string | null
          sku: string
          talla: string | null
          titulo: string
          updated_at: string
        }
        Insert: {
          activo?: boolean
          categoria?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notas?: string | null
          producto_id?: string | null
          sku: string
          talla?: string | null
          titulo: string
          updated_at?: string
        }
        Update: {
          activo?: boolean
          categoria?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notas?: string | null
          producto_id?: string | null
          sku?: string
          talla?: string | null
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conjuntos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conjuntos_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "producto_costos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conjuntos_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      conteos_fisicos: {
        Row: {
          cantidad: number
          contado_por: string | null
          corroborado_por: string | null
          created_at: string
          created_by: string | null
          descripcion: string | null
          fecha: string
          id: string
          nota: string | null
          producto_id: string | null
        }
        Insert: {
          cantidad: number
          contado_por?: string | null
          corroborado_por?: string | null
          created_at?: string
          created_by?: string | null
          descripcion?: string | null
          fecha?: string
          id?: string
          nota?: string | null
          producto_id?: string | null
        }
        Update: {
          cantidad?: number
          contado_por?: string | null
          corroborado_por?: string | null
          created_at?: string
          created_by?: string | null
          descripcion?: string | null
          fecha?: string
          id?: string
          nota?: string | null
          producto_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conteos_fisicos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conteos_fisicos_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "producto_costos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conteos_fisicos_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          canal: string | null
          ciudad: string | null
          correo: string | null
          cp: string | null
          created_at: string
          created_by: string | null
          estado: string | null
          id: string
          mercadolibre_buyer_id: number | null
          nombre: string
          notas: string | null
          telefono: string | null
          tiendanube_customer_id: number | null
          tiktok_buyer_id: string | null
          updated_at: string | null
        }
        Insert: {
          canal?: string | null
          ciudad?: string | null
          correo?: string | null
          cp?: string | null
          created_at?: string
          created_by?: string | null
          estado?: string | null
          id?: string
          mercadolibre_buyer_id?: number | null
          nombre?: string
          notas?: string | null
          telefono?: string | null
          tiendanube_customer_id?: number | null
          tiktok_buyer_id?: string | null
          updated_at?: string | null
        }
        Update: {
          canal?: string | null
          ciudad?: string | null
          correo?: string | null
          cp?: string | null
          created_at?: string
          created_by?: string | null
          estado?: string | null
          id?: string
          mercadolibre_buyer_id?: number | null
          nombre?: string
          notas?: string | null
          telefono?: string | null
          tiendanube_customer_id?: number | null
          tiktok_buyer_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dinero_permisos_canal: {
        Row: {
          canal: string
          created_at: string
          otorgado_por: string | null
          profile_id: string
        }
        Insert: {
          canal: string
          created_at?: string
          otorgado_por?: string | null
          profile_id: string
        }
        Update: {
          canal?: string
          created_at?: string
          otorgado_por?: string | null
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dinero_permisos_canal_otorgado_por_fkey"
            columns: ["otorgado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dinero_permisos_canal_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      empresa_avance: {
        Row: {
          actualizado_por: string | null
          empresa_id: string
          estado_actual: string | null
          updated_at: string
        }
        Insert: {
          actualizado_por?: string | null
          empresa_id: string
          estado_actual?: string | null
          updated_at?: string
        }
        Update: {
          actualizado_por?: string | null
          empresa_id?: string
          estado_actual?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "empresa_avance_actualizado_por_fkey"
            columns: ["actualizado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresa_avance_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: true
            referencedRelation: "agencia_empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      empresa_bitacora: {
        Row: {
          created_at: string
          created_by: string | null
          descripcion: string | null
          empresa_id: string
          fecha: string
          id: string
          titulo: string
          updated_at: string | null
          visibilidad: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          descripcion?: string | null
          empresa_id: string
          fecha?: string
          id?: string
          titulo: string
          updated_at?: string | null
          visibilidad?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          descripcion?: string | null
          empresa_id?: string
          fecha?: string
          id?: string
          titulo?: string
          updated_at?: string | null
          visibilidad?: string
        }
        Relationships: [
          {
            foreignKeyName: "empresa_bitacora_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresa_bitacora_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agencia_empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      empresa_bitacora_adjuntos: {
        Row: {
          created_at: string
          entrada_id: string
          id: string
          mime: string | null
          nombre: string
          storage_path: string
          subido_por: string | null
        }
        Insert: {
          created_at?: string
          entrada_id: string
          id?: string
          mime?: string | null
          nombre: string
          storage_path: string
          subido_por?: string | null
        }
        Update: {
          created_at?: string
          entrada_id?: string
          id?: string
          mime?: string | null
          nombre?: string
          storage_path?: string
          subido_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "empresa_bitacora_adjuntos_entrada_id_fkey"
            columns: ["entrada_id"]
            isOneToOne: false
            referencedRelation: "empresa_bitacora"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresa_bitacora_adjuntos_subido_por_fkey"
            columns: ["subido_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      empresa_documento_versiones: {
        Row: {
          created_at: string
          documento_id: string
          id: string
          mime: string | null
          nombre_archivo: string
          nota: string | null
          storage_path: string
          subido_por: string | null
          tamano: number | null
          version: number
        }
        Insert: {
          created_at?: string
          documento_id: string
          id?: string
          mime?: string | null
          nombre_archivo: string
          nota?: string | null
          storage_path: string
          subido_por?: string | null
          tamano?: number | null
          version: number
        }
        Update: {
          created_at?: string
          documento_id?: string
          id?: string
          mime?: string | null
          nombre_archivo?: string
          nota?: string | null
          storage_path?: string
          subido_por?: string | null
          tamano?: number | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "empresa_documento_versiones_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "empresa_documentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresa_documento_versiones_subido_por_fkey"
            columns: ["subido_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      empresa_documentos: {
        Row: {
          archivado_at: string | null
          aviso_vencimiento_en: string | null
          categoria: string
          created_at: string
          created_by: string | null
          descripcion: string | null
          empresa_id: string
          etiquetas: string[]
          id: string
          nombre: string
          updated_at: string | null
          vigente_hasta: string | null
          visibilidad: string
        }
        Insert: {
          archivado_at?: string | null
          aviso_vencimiento_en?: string | null
          categoria?: string
          created_at?: string
          created_by?: string | null
          descripcion?: string | null
          empresa_id: string
          etiquetas?: string[]
          id?: string
          nombre: string
          updated_at?: string | null
          vigente_hasta?: string | null
          visibilidad?: string
        }
        Update: {
          archivado_at?: string | null
          aviso_vencimiento_en?: string | null
          categoria?: string
          created_at?: string
          created_by?: string | null
          descripcion?: string | null
          empresa_id?: string
          etiquetas?: string[]
          id?: string
          nombre?: string
          updated_at?: string | null
          vigente_hasta?: string | null
          visibilidad?: string
        }
        Relationships: [
          {
            foreignKeyName: "empresa_documentos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresa_documentos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agencia_empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      empresa_eventos: {
        Row: {
          archivado_at: string | null
          created_at: string
          created_by: string | null
          descripcion: string | null
          empresa_id: string
          id: string
          inicia_en: string
          titulo: string
          updated_at: string | null
          visibilidad: string
        }
        Insert: {
          archivado_at?: string | null
          created_at?: string
          created_by?: string | null
          descripcion?: string | null
          empresa_id: string
          id?: string
          inicia_en: string
          titulo: string
          updated_at?: string | null
          visibilidad?: string
        }
        Update: {
          archivado_at?: string | null
          created_at?: string
          created_by?: string | null
          descripcion?: string | null
          empresa_id?: string
          id?: string
          inicia_en?: string
          titulo?: string
          updated_at?: string | null
          visibilidad?: string
        }
        Relationships: [
          {
            foreignKeyName: "empresa_eventos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresa_eventos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agencia_empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      empresa_incidencias: {
        Row: {
          created_at: string
          created_by: string | null
          desbloquea: string
          descripcion: string | null
          detectada_en: string
          empresa_id: string
          estado: string
          id: string
          impacto: string | null
          resuelta_en: string | null
          titulo: string
          updated_at: string | null
          visibilidad: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          desbloquea: string
          descripcion?: string | null
          detectada_en?: string
          empresa_id: string
          estado?: string
          id?: string
          impacto?: string | null
          resuelta_en?: string | null
          titulo: string
          updated_at?: string | null
          visibilidad?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          desbloquea?: string
          descripcion?: string | null
          detectada_en?: string
          empresa_id?: string
          estado?: string
          id?: string
          impacto?: string | null
          resuelta_en?: string | null
          titulo?: string
          updated_at?: string | null
          visibilidad?: string
        }
        Relationships: [
          {
            foreignKeyName: "empresa_incidencias_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresa_incidencias_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agencia_empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      envio_full_cajas: {
        Row: {
          alto_cm: number | null
          ancho_cm: number | null
          dimensiones: string | null
          envio_id: string
          id: string
          largo_cm: number | null
          numero: number
          peso_kg: number | null
        }
        Insert: {
          alto_cm?: number | null
          ancho_cm?: number | null
          dimensiones?: string | null
          envio_id: string
          id?: string
          largo_cm?: number | null
          numero: number
          peso_kg?: number | null
        }
        Update: {
          alto_cm?: number | null
          ancho_cm?: number | null
          dimensiones?: string | null
          envio_id?: string
          id?: string
          largo_cm?: number | null
          numero?: number
          peso_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "envio_full_cajas_envio_id_fkey"
            columns: ["envio_id"]
            isOneToOne: false
            referencedRelation: "envios_full"
            referencedColumns: ["id"]
          },
        ]
      }
      envio_full_items: {
        Row: {
          asin: string | null
          caja_id: string
          cancelado: boolean
          cantidad: number
          descontado: boolean
          empaquetado: boolean
          id: string
          producto_id: string | null
          sku: string
        }
        Insert: {
          asin?: string | null
          caja_id: string
          cancelado?: boolean
          cantidad: number
          descontado?: boolean
          empaquetado?: boolean
          id?: string
          producto_id?: string | null
          sku: string
        }
        Update: {
          asin?: string | null
          caja_id?: string
          cancelado?: boolean
          cantidad?: number
          descontado?: boolean
          empaquetado?: boolean
          id?: string
          producto_id?: string | null
          sku?: string
        }
        Relationships: [
          {
            foreignKeyName: "envio_full_items_caja_id_fkey"
            columns: ["caja_id"]
            isOneToOne: false
            referencedRelation: "envio_full_cajas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "envio_full_items_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "producto_costos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "envio_full_items_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      envios_full: {
        Row: {
          created_at: string
          created_by: string | null
          destino: string
          estado: string
          fecha_envio: string | null
          fecha_llegada_estimada: string | null
          id: string
          id_plataforma: string | null
          nombre: string
          notas: string | null
          num_guia: string | null
          paqueteria: string | null
          tipo_envio: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          destino: string
          estado?: string
          fecha_envio?: string | null
          fecha_llegada_estimada?: string | null
          id?: string
          id_plataforma?: string | null
          nombre: string
          notas?: string | null
          num_guia?: string | null
          paqueteria?: string | null
          tipo_envio?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          destino?: string
          estado?: string
          fecha_envio?: string | null
          fecha_llegada_estimada?: string | null
          id?: string
          id_plataforma?: string | null
          nombre?: string
          notas?: string | null
          num_guia?: string | null
          paqueteria?: string | null
          tipo_envio?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "envios_full_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_receipts: {
        Row: {
          created_at: string
          expense_id: string
          id: string
          nombre: string
          storage_path: string
          tipo: string | null
        }
        Insert: {
          created_at?: string
          expense_id: string
          id?: string
          nombre: string
          storage_path: string
          tipo?: string | null
        }
        Update: {
          created_at?: string
          expense_id?: string
          id?: string
          nombre?: string
          storage_path?: string
          tipo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_receipts_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          categoria: string
          clave: string | null
          concepto: string
          created_at: string
          created_by: string | null
          factura: string
          fecha: string
          id: string
          metodo_pago: string | null
          monto: number
          notas: string | null
          proveedor: string | null
          recibo: string
          updated_at: string | null
        }
        Insert: {
          categoria?: string
          clave?: string | null
          concepto: string
          created_at?: string
          created_by?: string | null
          factura?: string
          fecha?: string
          id?: string
          metodo_pago?: string | null
          monto: number
          notas?: string | null
          proveedor?: string | null
          recibo?: string
          updated_at?: string | null
        }
        Update: {
          categoria?: string
          clave?: string | null
          concepto?: string
          created_at?: string
          created_by?: string | null
          factura?: string
          fecha?: string
          id?: string
          metodo_pago?: string | null
          monto?: number
          notas?: string | null
          proveedor?: string | null
          recibo?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      influencer_entregas: {
        Row: {
          cantidad: number
          created_at: string
          created_by: string | null
          descripcion: string | null
          fecha: string
          id: string
          influencer_id: string
          notas: string | null
          producto_id: string | null
          talla: string | null
          valor: number | null
        }
        Insert: {
          cantidad?: number
          created_at?: string
          created_by?: string | null
          descripcion?: string | null
          fecha?: string
          id?: string
          influencer_id: string
          notas?: string | null
          producto_id?: string | null
          talla?: string | null
          valor?: number | null
        }
        Update: {
          cantidad?: number
          created_at?: string
          created_by?: string | null
          descripcion?: string | null
          fecha?: string
          id?: string
          influencer_id?: string
          notas?: string | null
          producto_id?: string | null
          talla?: string | null
          valor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "influencer_entregas_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "influencer_entregas_influencer_id_fkey"
            columns: ["influencer_id"]
            isOneToOne: false
            referencedRelation: "influencers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "influencer_entregas_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "producto_costos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "influencer_entregas_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      influencer_evaluaciones: {
        Row: {
          contenido_organico: boolean
          created_at: string
          created_by: string | null
          id: string
          influencer_id: string
          observaciones: string | null
          participaciones: number | null
          periodo: string
          stories: number | null
          usos_codigo: number | null
          ventas_monto: number | null
          videos: number | null
        }
        Insert: {
          contenido_organico?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          influencer_id: string
          observaciones?: string | null
          participaciones?: number | null
          periodo: string
          stories?: number | null
          usos_codigo?: number | null
          ventas_monto?: number | null
          videos?: number | null
        }
        Update: {
          contenido_organico?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          influencer_id?: string
          observaciones?: string | null
          participaciones?: number | null
          periodo?: string
          stories?: number | null
          usos_codigo?: number | null
          ventas_monto?: number | null
          videos?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "influencer_evaluaciones_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "influencer_evaluaciones_influencer_id_fkey"
            columns: ["influencer_id"]
            isOneToOne: false
            referencedRelation: "influencers"
            referencedColumns: ["id"]
          },
        ]
      }
      influencers: {
        Row: {
          celular: string | null
          codigo: string | null
          comision_pct: number | null
          correo: string | null
          created_at: string
          created_by: string | null
          credito_mensual: number | null
          descuento_pct: number | null
          etapa: string
          id: string
          ig_seguidores: number | null
          ig_usuario: string | null
          inicio_prueba: string | null
          nombre: string
          notas: string | null
          tier: string | null
          tiktok_seguidores: number | null
          tiktok_usuario: string | null
          tipo_contenido: string | null
          updated_at: string
        }
        Insert: {
          celular?: string | null
          codigo?: string | null
          comision_pct?: number | null
          correo?: string | null
          created_at?: string
          created_by?: string | null
          credito_mensual?: number | null
          descuento_pct?: number | null
          etapa?: string
          id?: string
          ig_seguidores?: number | null
          ig_usuario?: string | null
          inicio_prueba?: string | null
          nombre: string
          notas?: string | null
          tier?: string | null
          tiktok_seguidores?: number | null
          tiktok_usuario?: string | null
          tipo_contenido?: string | null
          updated_at?: string
        }
        Update: {
          celular?: string | null
          codigo?: string | null
          comision_pct?: number | null
          correo?: string | null
          created_at?: string
          created_by?: string | null
          credito_mensual?: number | null
          descuento_pct?: number | null
          etapa?: string
          id?: string
          ig_seguidores?: number | null
          ig_usuario?: string | null
          inicio_prueba?: string | null
          nombre?: string
          notas?: string | null
          tier?: string | null
          tiktok_seguidores?: number | null
          tiktok_usuario?: string | null
          tipo_contenido?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "influencers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      insumo_movimientos: {
        Row: {
          cantidad: number
          created_at: string
          created_by: string | null
          id: string
          insumo_id: string
          motivo: string | null
          stock_resultante: number | null
          tipo: string
        }
        Insert: {
          cantidad: number
          created_at?: string
          created_by?: string | null
          id?: string
          insumo_id: string
          motivo?: string | null
          stock_resultante?: number | null
          tipo: string
        }
        Update: {
          cantidad?: number
          created_at?: string
          created_by?: string | null
          id?: string
          insumo_id?: string
          motivo?: string | null
          stock_resultante?: number | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "insumo_movimientos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insumo_movimientos_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "insumos"
            referencedColumns: ["id"]
          },
        ]
      }
      insumo_permisos: {
        Row: {
          created_at: string
          otorgado_por: string | null
          profile_id: string
          puede_descontar: boolean
        }
        Insert: {
          created_at?: string
          otorgado_por?: string | null
          profile_id: string
          puede_descontar?: boolean
        }
        Update: {
          created_at?: string
          otorgado_por?: string | null
          profile_id?: string
          puede_descontar?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "insumo_permisos_otorgado_por_fkey"
            columns: ["otorgado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insumo_permisos_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      insumo_presentaciones: {
        Row: {
          clave: string | null
          created_at: string
          descripcion: string | null
          id: string
          insumo_id: string
          link: string | null
          pedido: number
          precio: number | null
          reserva: number
          unidades: number
        }
        Insert: {
          clave?: string | null
          created_at?: string
          descripcion?: string | null
          id?: string
          insumo_id: string
          link?: string | null
          pedido?: number
          precio?: number | null
          reserva?: number
          unidades?: number
        }
        Update: {
          clave?: string | null
          created_at?: string
          descripcion?: string | null
          id?: string
          insumo_id?: string
          link?: string | null
          pedido?: number
          precio?: number | null
          reserva?: number
          unidades?: number
        }
        Relationships: [
          {
            foreignKeyName: "insumo_presentaciones_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "insumos"
            referencedColumns: ["id"]
          },
        ]
      }
      insumos: {
        Row: {
          activo: boolean
          categoria: string | null
          clave: string | null
          created_at: string
          created_by: string | null
          dimensiones: string | null
          empresa: string | null
          id: string
          link: string | null
          maximo: number | null
          minimo: number
          nombre: string
          notas: string | null
          pedido: number
          reserva: number
          stock: number
          unidad: string
          updated_at: string
        }
        Insert: {
          activo?: boolean
          categoria?: string | null
          clave?: string | null
          created_at?: string
          created_by?: string | null
          dimensiones?: string | null
          empresa?: string | null
          id?: string
          link?: string | null
          maximo?: number | null
          minimo?: number
          nombre: string
          notas?: string | null
          pedido?: number
          reserva?: number
          stock?: number
          unidad?: string
          updated_at?: string
        }
        Update: {
          activo?: boolean
          categoria?: string | null
          clave?: string | null
          created_at?: string
          created_by?: string | null
          dimensiones?: string | null
          empresa?: string | null
          id?: string
          link?: string | null
          maximo?: number | null
          minimo?: number
          nombre?: string
          notas?: string | null
          pedido?: number
          reserva?: number
          stock?: number
          unidad?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "insumos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      integraciones: {
        Row: {
          access_token: string
          created_at: string
          datos: Json
          expires_at: string | null
          external_id: string
          id: string
          refresh_token: string | null
          updated_at: string | null
        }
        Insert: {
          access_token: string
          created_at?: string
          datos?: Json
          expires_at?: string | null
          external_id: string
          id: string
          refresh_token?: string | null
          updated_at?: string | null
        }
        Update: {
          access_token?: string
          created_at?: string
          datos?: Json
          expires_at?: string | null
          external_id?: string
          id?: string
          refresh_token?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      maquila_anticipos: {
        Row: {
          comprobante_nombre: string | null
          comprobante_path: string | null
          concepto: string
          created_at: string
          created_by: string | null
          especie_cantidad: number | null
          especie_unidad: string | null
          fecha: string
          id: string
          monto: number
          notas: string | null
          tipo: string
          updated_at: string
        }
        Insert: {
          comprobante_nombre?: string | null
          comprobante_path?: string | null
          concepto: string
          created_at?: string
          created_by?: string | null
          especie_cantidad?: number | null
          especie_unidad?: string | null
          fecha?: string
          id?: string
          monto: number
          notas?: string | null
          tipo?: string
          updated_at?: string
        }
        Update: {
          comprobante_nombre?: string | null
          comprobante_path?: string | null
          concepto?: string
          created_at?: string
          created_by?: string | null
          especie_cantidad?: number | null
          especie_unidad?: string | null
          fecha?: string
          id?: string
          monto?: number
          notas?: string | null
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "maquila_anticipos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      maquila_config: {
        Row: {
          hora_limite: string
          id: number
          sabado_habil: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          hora_limite?: string
          id: number
          sabado_habil?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          hora_limite?: string
          id?: number
          sabado_habil?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maquila_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      maquila_consignacion: {
        Row: {
          insumo_id: string
          saldo: number
          updated_at: string
        }
        Insert: {
          insumo_id: string
          saldo?: number
          updated_at?: string
        }
        Update: {
          insumo_id?: string
          saldo?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "maquila_consignacion_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: true
            referencedRelation: "maquila_insumos"
            referencedColumns: ["id"]
          },
        ]
      }
      maquila_consignacion_movs: {
        Row: {
          cantidad: number
          created_at: string
          created_by: string | null
          id: string
          insumo_id: string
          lote: string | null
          motivo: string | null
          pedido_id: string | null
          saldo_resultante: number
          tipo: string
        }
        Insert: {
          cantidad: number
          created_at?: string
          created_by?: string | null
          id?: string
          insumo_id: string
          lote?: string | null
          motivo?: string | null
          pedido_id?: string | null
          saldo_resultante: number
          tipo: string
        }
        Update: {
          cantidad?: number
          created_at?: string
          created_by?: string | null
          id?: string
          insumo_id?: string
          lote?: string | null
          motivo?: string | null
          pedido_id?: string | null
          saldo_resultante?: number
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "maquila_consignacion_movs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquila_consignacion_movs_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "maquila_insumos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquila_consignacion_movs_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "maquila_pedidos"
            referencedColumns: ["id"]
          },
        ]
      }
      maquila_corte_anticipos: {
        Row: {
          anticipo_id: string
          anulado: boolean
          corte_id: string
          created_at: string
          monto: number
        }
        Insert: {
          anticipo_id: string
          anulado?: boolean
          corte_id: string
          created_at?: string
          monto: number
        }
        Update: {
          anticipo_id?: string
          anulado?: boolean
          corte_id?: string
          created_at?: string
          monto?: number
        }
        Relationships: [
          {
            foreignKeyName: "maquila_corte_anticipos_anticipo_id_fkey"
            columns: ["anticipo_id"]
            isOneToOne: false
            referencedRelation: "maquila_anticipos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquila_corte_anticipos_anticipo_id_fkey"
            columns: ["anticipo_id"]
            isOneToOne: false
            referencedRelation: "maquila_anticipos_saldo"
            referencedColumns: ["anticipo_id"]
          },
          {
            foreignKeyName: "maquila_corte_anticipos_corte_id_fkey"
            columns: ["corte_id"]
            isOneToOne: false
            referencedRelation: "maquila_cortes"
            referencedColumns: ["id"]
          },
        ]
      }
      maquila_corte_renglones: {
        Row: {
          acabado: string | null
          anulado: boolean
          cantidad: number
          concepto: string | null
          corte_id: string
          costo_unitario: number
          created_at: string
          enviado_en: string | null
          id: string
          importe: number
          modelo: string | null
          pedido_id: string | null
        }
        Insert: {
          acabado?: string | null
          anulado?: boolean
          cantidad?: number
          concepto?: string | null
          corte_id: string
          costo_unitario?: number
          created_at?: string
          enviado_en?: string | null
          id?: string
          importe?: number
          modelo?: string | null
          pedido_id?: string | null
        }
        Update: {
          acabado?: string | null
          anulado?: boolean
          cantidad?: number
          concepto?: string | null
          corte_id?: string
          costo_unitario?: number
          created_at?: string
          enviado_en?: string | null
          id?: string
          importe?: number
          modelo?: string | null
          pedido_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maquila_corte_renglones_corte_id_fkey"
            columns: ["corte_id"]
            isOneToOne: false
            referencedRelation: "maquila_cortes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquila_corte_renglones_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "maquila_pedidos"
            referencedColumns: ["id"]
          },
        ]
      }
      maquila_cortes: {
        Row: {
          anticipos_aplicados: number
          cerrado_en: string | null
          cerrado_por: string | null
          created_at: string
          created_by: string | null
          estado: string
          expense_id: string | null
          factura_folio: string | null
          factura_path: string | null
          factura_uuid: string | null
          id: string
          iva: number
          iva_tasa: number
          metodo_pago: string | null
          notas: string | null
          pagado_en: string | null
          pagado_por: string | null
          periodo_desde: string
          periodo_hasta: string
          piezas: number
          subtotal: number
          total: number
          updated_at: string
        }
        Insert: {
          anticipos_aplicados?: number
          cerrado_en?: string | null
          cerrado_por?: string | null
          created_at?: string
          created_by?: string | null
          estado?: string
          expense_id?: string | null
          factura_folio?: string | null
          factura_path?: string | null
          factura_uuid?: string | null
          id?: string
          iva?: number
          iva_tasa?: number
          metodo_pago?: string | null
          notas?: string | null
          pagado_en?: string | null
          pagado_por?: string | null
          periodo_desde: string
          periodo_hasta: string
          piezas?: number
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Update: {
          anticipos_aplicados?: number
          cerrado_en?: string | null
          cerrado_por?: string | null
          created_at?: string
          created_by?: string | null
          estado?: string
          expense_id?: string | null
          factura_folio?: string | null
          factura_path?: string | null
          factura_uuid?: string | null
          id?: string
          iva?: number
          iva_tasa?: number
          metodo_pago?: string | null
          notas?: string | null
          pagado_en?: string | null
          pagado_por?: string | null
          periodo_desde?: string
          periodo_hasta?: string
          piezas?: number
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "maquila_cortes_cerrado_por_fkey"
            columns: ["cerrado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquila_cortes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquila_cortes_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquila_cortes_pagado_por_fkey"
            columns: ["pagado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      maquila_costos: {
        Row: {
          acabado: string
          costo: number
          created_at: string
          created_by: string | null
          id: string
          modelo: string
          vigente_desde: string
        }
        Insert: {
          acabado: string
          costo: number
          created_at?: string
          created_by?: string | null
          id?: string
          modelo: string
          vigente_desde?: string
        }
        Update: {
          acabado?: string
          costo?: number
          created_at?: string
          created_by?: string | null
          id?: string
          modelo?: string
          vigente_desde?: string
        }
        Relationships: [
          {
            foreignKeyName: "maquila_costos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      maquila_disenos: {
        Row: {
          acabado: string | null
          activo: boolean
          archivo_mime: string | null
          archivo_nombre: string | null
          archivo_path: string | null
          coleccion: string | null
          created_at: string
          created_by: string | null
          id: string
          nombre: string
          notas: string | null
          updated_at: string
        }
        Insert: {
          acabado?: string | null
          activo?: boolean
          archivo_mime?: string | null
          archivo_nombre?: string | null
          archivo_path?: string | null
          coleccion?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          nombre: string
          notas?: string | null
          updated_at?: string
        }
        Update: {
          acabado?: string | null
          activo?: boolean
          archivo_mime?: string | null
          archivo_nombre?: string | null
          archivo_path?: string | null
          coleccion?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          nombre?: string
          notas?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "maquila_disenos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      maquila_eventos: {
        Row: {
          a: string | null
          autor: string | null
          created_at: string
          de: string | null
          detalle: string | null
          id: number
          pedido_id: string
          tipo: string
        }
        Insert: {
          a?: string | null
          autor?: string | null
          created_at?: string
          de?: string | null
          detalle?: string | null
          id?: never
          pedido_id: string
          tipo: string
        }
        Update: {
          a?: string | null
          autor?: string | null
          created_at?: string
          de?: string | null
          detalle?: string | null
          id?: never
          pedido_id?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "maquila_eventos_autor_fkey"
            columns: ["autor"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquila_eventos_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "maquila_pedidos"
            referencedColumns: ["id"]
          },
        ]
      }
      maquila_festivos: {
        Row: {
          created_at: string
          created_by: string | null
          fecha: string
          motivo: string | null
          tipo: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          fecha: string
          motivo?: string | null
          tipo?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          fecha?: string
          motivo?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "maquila_festivos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      maquila_guias: {
        Row: {
          archivo_mime: string | null
          archivo_nombre: string | null
          archivo_path: string | null
          canal: string
          cargada_en: string | null
          cargada_por: string | null
          created_at: string
          entregada_en: string | null
          estado: string
          grupo: string
          id: string
          notas: string | null
          num_guia: string | null
          paqueteria: string | null
          solicitada_en: string
          updated_at: string
        }
        Insert: {
          archivo_mime?: string | null
          archivo_nombre?: string | null
          archivo_path?: string | null
          canal: string
          cargada_en?: string | null
          cargada_por?: string | null
          created_at?: string
          entregada_en?: string | null
          estado?: string
          grupo: string
          id?: string
          notas?: string | null
          num_guia?: string | null
          paqueteria?: string | null
          solicitada_en?: string
          updated_at?: string
        }
        Update: {
          archivo_mime?: string | null
          archivo_nombre?: string | null
          archivo_path?: string | null
          canal?: string
          cargada_en?: string | null
          cargada_por?: string | null
          created_at?: string
          entregada_en?: string | null
          estado?: string
          grupo?: string
          id?: string
          notas?: string | null
          num_guia?: string | null
          paqueteria?: string | null
          solicitada_en?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "maquila_guias_cargada_por_fkey"
            columns: ["cargada_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      maquila_incidencias: {
        Row: {
          abierta: boolean
          created_at: string
          created_by: string | null
          dirigida_a: string
          id: string
          pedido_id: string
          respuesta: string | null
          resuelta_en: string | null
          resuelta_por: string | null
          texto: string
          tipo: string
        }
        Insert: {
          abierta?: boolean
          created_at?: string
          created_by?: string | null
          dirigida_a?: string
          id?: string
          pedido_id: string
          respuesta?: string | null
          resuelta_en?: string | null
          resuelta_por?: string | null
          texto: string
          tipo?: string
        }
        Update: {
          abierta?: boolean
          created_at?: string
          created_by?: string | null
          dirigida_a?: string
          id?: string
          pedido_id?: string
          respuesta?: string | null
          resuelta_en?: string | null
          resuelta_por?: string | null
          texto?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "maquila_incidencias_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquila_incidencias_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "maquila_pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquila_incidencias_resuelta_por_fkey"
            columns: ["resuelta_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      maquila_insumos: {
        Row: {
          activo: boolean
          clave: string
          created_at: string
          created_by: string | null
          id: string
          minimo: number
          nombre: string
          notas: string | null
          producto_id: string | null
          unidad: string
          updated_at: string
        }
        Insert: {
          activo?: boolean
          clave: string
          created_at?: string
          created_by?: string | null
          id?: string
          minimo?: number
          nombre: string
          notas?: string | null
          producto_id?: string | null
          unidad?: string
          updated_at?: string
        }
        Update: {
          activo?: boolean
          clave?: string
          created_at?: string
          created_by?: string | null
          id?: string
          minimo?: number
          nombre?: string
          notas?: string | null
          producto_id?: string | null
          unidad?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "maquila_insumos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquila_insumos_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "producto_costos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquila_insumos_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      maquila_pedido_costos: {
        Row: {
          congelado_en: string
          costo: number | null
          pedido_id: string
          tarifa_id: string | null
        }
        Insert: {
          congelado_en?: string
          costo?: number | null
          pedido_id: string
          tarifa_id?: string | null
        }
        Update: {
          congelado_en?: string
          costo?: number | null
          pedido_id?: string
          tarifa_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maquila_pedido_costos_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: true
            referencedRelation: "maquila_pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquila_pedido_costos_tarifa_id_fkey"
            columns: ["tarifa_id"]
            isOneToOne: false
            referencedRelation: "maquila_costos"
            referencedColumns: ["id"]
          },
        ]
      }
      maquila_pedidos: {
        Row: {
          acabado: string
          canal: string
          cantidad: number
          color: string | null
          combo: string
          combo_diseno: string | null
          corte_fecha: string | null
          costo_maquila: number | null
          created_at: string
          created_by: string | null
          diseno: string | null
          diseno_id: string | null
          diseno_listo_en: string | null
          diseno_listo_por: string | null
          entregado_en: string | null
          enviado_en: string | null
          envio_direccion: Json | null
          envio_nombre: string | null
          envio_telefono: string | null
          estado: string
          fecha_prometida: string | null
          id: string
          modelo: string
          notas: string | null
          num_guia: string | null
          numero_orden: string | null
          origen: string
          pagado_en: string | null
          palanca_color: string | null
          paqueteria: string | null
          personalizado_id: string | null
          producto_id: string | null
          referencia_externa: string | null
          referencia_orden: string | null
          requiere_palanca: boolean
          ruta: string | null
          sale_id: string | null
          sku: string | null
          subestado: string | null
          talla: string | null
          terminado_en: string | null
          updated_at: string
          url_rastreo: string | null
        }
        Insert: {
          acabado: string
          canal: string
          cantidad?: number
          color?: string | null
          combo?: string
          combo_diseno?: string | null
          corte_fecha?: string | null
          costo_maquila?: number | null
          created_at?: string
          created_by?: string | null
          diseno?: string | null
          diseno_id?: string | null
          diseno_listo_en?: string | null
          diseno_listo_por?: string | null
          entregado_en?: string | null
          enviado_en?: string | null
          envio_direccion?: Json | null
          envio_nombre?: string | null
          envio_telefono?: string | null
          estado?: string
          fecha_prometida?: string | null
          id?: string
          modelo: string
          notas?: string | null
          num_guia?: string | null
          numero_orden?: string | null
          origen?: string
          pagado_en?: string | null
          palanca_color?: string | null
          paqueteria?: string | null
          personalizado_id?: string | null
          producto_id?: string | null
          referencia_externa?: string | null
          referencia_orden?: string | null
          requiere_palanca?: boolean
          ruta?: string | null
          sale_id?: string | null
          sku?: string | null
          subestado?: string | null
          talla?: string | null
          terminado_en?: string | null
          updated_at?: string
          url_rastreo?: string | null
        }
        Update: {
          acabado?: string
          canal?: string
          cantidad?: number
          color?: string | null
          combo?: string
          combo_diseno?: string | null
          corte_fecha?: string | null
          costo_maquila?: number | null
          created_at?: string
          created_by?: string | null
          diseno?: string | null
          diseno_id?: string | null
          diseno_listo_en?: string | null
          diseno_listo_por?: string | null
          entregado_en?: string | null
          enviado_en?: string | null
          envio_direccion?: Json | null
          envio_nombre?: string | null
          envio_telefono?: string | null
          estado?: string
          fecha_prometida?: string | null
          id?: string
          modelo?: string
          notas?: string | null
          num_guia?: string | null
          numero_orden?: string | null
          origen?: string
          pagado_en?: string | null
          palanca_color?: string | null
          paqueteria?: string | null
          personalizado_id?: string | null
          producto_id?: string | null
          referencia_externa?: string | null
          referencia_orden?: string | null
          requiere_palanca?: boolean
          ruta?: string | null
          sale_id?: string | null
          sku?: string | null
          subestado?: string | null
          talla?: string | null
          terminado_en?: string | null
          updated_at?: string
          url_rastreo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maquila_pedidos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquila_pedidos_diseno_id_fkey"
            columns: ["diseno_id"]
            isOneToOne: false
            referencedRelation: "maquila_disenos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquila_pedidos_diseno_listo_por_fkey"
            columns: ["diseno_listo_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquila_pedidos_personalizado_id_fkey"
            columns: ["personalizado_id"]
            isOneToOne: false
            referencedRelation: "personalizados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquila_pedidos_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "producto_costos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquila_pedidos_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquila_pedidos_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquila_pedidos_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "ventas_montos"
            referencedColumns: ["id"]
          },
        ]
      }
      maquila_productos: {
        Row: {
          acabado: string
          activo: boolean
          combo: string
          created_at: string
          created_by: string | null
          modelo: string
          producto_id: string
          updated_at: string
        }
        Insert: {
          acabado: string
          activo?: boolean
          combo?: string
          created_at?: string
          created_by?: string | null
          modelo: string
          producto_id: string
          updated_at?: string
        }
        Update: {
          acabado?: string
          activo?: boolean
          combo?: string
          created_at?: string
          created_by?: string | null
          modelo?: string
          producto_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "maquila_productos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquila_productos_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: true
            referencedRelation: "producto_costos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquila_productos_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      meli_publicaciones: {
        Row: {
          creado_en: string
          id: number
          meli_item_id: string
          meli_user_product_id: string | null
          meli_variation_id: number | null
          principal: boolean
          producto_id: string
          unidad: string | null
        }
        Insert: {
          creado_en?: string
          id?: never
          meli_item_id: string
          meli_user_product_id?: string | null
          meli_variation_id?: number | null
          principal?: boolean
          producto_id: string
          unidad?: string | null
        }
        Update: {
          creado_en?: string
          id?: never
          meli_item_id?: string
          meli_user_product_id?: string | null
          meli_variation_id?: number | null
          principal?: boolean
          producto_id?: string
          unidad?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meli_publicaciones_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "producto_costos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meli_publicaciones_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      nomina_empleados: {
        Row: {
          activo: boolean
          created_at: string
          dia_corte: number | null
          empresa_id: string | null
          esquema: string
          fin: string | null
          id: string
          inicio: string | null
          monto: number
          nombre: string
          notas: string | null
          periodicidad: string
          profile_id: string | null
          puesto: string | null
          situacion: string
          updated_at: string | null
        }
        Insert: {
          activo?: boolean
          created_at?: string
          dia_corte?: number | null
          empresa_id?: string | null
          esquema?: string
          fin?: string | null
          id?: string
          inicio?: string | null
          monto?: number
          nombre: string
          notas?: string | null
          periodicidad?: string
          profile_id?: string | null
          puesto?: string | null
          situacion?: string
          updated_at?: string | null
        }
        Update: {
          activo?: boolean
          created_at?: string
          dia_corte?: number | null
          empresa_id?: string | null
          esquema?: string
          fin?: string | null
          id?: string
          inicio?: string | null
          monto?: number
          nombre?: string
          notas?: string | null
          periodicidad?: string
          profile_id?: string | null
          puesto?: string | null
          situacion?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nomina_empleados_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agencia_empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nomina_empleados_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      nomina_pagos: {
        Row: {
          comprobante: string | null
          created_at: string
          created_by: string | null
          empleado_id: string
          estado: string
          fecha_pago: string | null
          id: string
          metodo: string | null
          monto: number
          notas: string | null
          periodo_desde: string | null
          periodo_hasta: string | null
          updated_at: string | null
        }
        Insert: {
          comprobante?: string | null
          created_at?: string
          created_by?: string | null
          empleado_id: string
          estado?: string
          fecha_pago?: string | null
          id?: string
          metodo?: string | null
          monto: number
          notas?: string | null
          periodo_desde?: string | null
          periodo_hasta?: string | null
          updated_at?: string | null
        }
        Update: {
          comprobante?: string | null
          created_at?: string
          created_by?: string | null
          empleado_id?: string
          estado?: string
          fecha_pago?: string | null
          id?: string
          metodo?: string | null
          monto?: number
          notas?: string | null
          periodo_desde?: string | null
          periodo_hasta?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nomina_pagos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nomina_pagos_empleado_id_fkey"
            columns: ["empleado_id"]
            isOneToOne: false
            referencedRelation: "nomina_empleados"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          leida: boolean
          push_enviado_at: string | null
          task_id: string | null
          texto: string
          tipo: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          leida?: boolean
          push_enviado_at?: string | null
          task_id?: string | null
          texto: string
          tipo?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          leida?: boolean
          push_enviado_at?: string | null
          task_id?: string | null
          texto?: string
          tipo?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      personalizados: {
        Row: {
          canal: string | null
          clave: string | null
          cliente: string
          created_at: string
          created_by: string | null
          estado: string
          fecha_compra: string | null
          fecha_limite: string | null
          fecha_produccion: string | null
          foto_path: string | null
          id: string
          modelo: string | null
          no_venta: string | null
          notas: string | null
          responsable_id: string | null
          sale_order_id: string | null
          talla: string | null
          tipo: string | null
          updated_at: string
          url: string | null
        }
        Insert: {
          canal?: string | null
          clave?: string | null
          cliente: string
          created_at?: string
          created_by?: string | null
          estado?: string
          fecha_compra?: string | null
          fecha_limite?: string | null
          fecha_produccion?: string | null
          foto_path?: string | null
          id?: string
          modelo?: string | null
          no_venta?: string | null
          notas?: string | null
          responsable_id?: string | null
          sale_order_id?: string | null
          talla?: string | null
          tipo?: string | null
          updated_at?: string
          url?: string | null
        }
        Update: {
          canal?: string | null
          clave?: string | null
          cliente?: string
          created_at?: string
          created_by?: string | null
          estado?: string
          fecha_compra?: string | null
          fecha_limite?: string | null
          fecha_produccion?: string | null
          foto_path?: string | null
          id?: string
          modelo?: string | null
          no_venta?: string | null
          notas?: string | null
          responsable_id?: string | null
          sale_order_id?: string | null
          talla?: string | null
          tipo?: string | null
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "personalizados_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personalizados_responsable_id_fkey"
            columns: ["responsable_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      product_photos: {
        Row: {
          created_at: string
          id: string
          nombre: string
          orden: number
          producto_id: string
          storage_path: string
          tipo: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          nombre: string
          orden?: number
          producto_id: string
          storage_path: string
          tipo?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          nombre?: string
          orden?: number
          producto_id?: string
          storage_path?: string
          tipo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_photos_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "producto_costos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_photos_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          activo: boolean
          bajo_pedido: boolean
          costo: number | null
          created_at: string
          created_by: string | null
          descontinuado: boolean
          id: string
          imagen_url: string | null
          imagenes: Json
          meli_item_id: string | null
          meli_logistic_type: string | null
          meli_permalink: string | null
          meli_stock_full: number | null
          meli_user_product_id: string | null
          meli_variation_id: number | null
          nombre: string
          notas: string | null
          precio: number | null
          proveedor_id: string | null
          sku: string | null
          stock: number
          stock_minimo: number
          tiendanube_permalink: string | null
          tiendanube_product_id: number | null
          tiendanube_variant_id: number | null
          tiktok_product_id: string | null
          tiktok_sku_id: string | null
          tiktok_stock: number | null
          tipo: string
          updated_at: string | null
          variante: string | null
        }
        Insert: {
          activo?: boolean
          bajo_pedido?: boolean
          costo?: number | null
          created_at?: string
          created_by?: string | null
          descontinuado?: boolean
          id?: string
          imagen_url?: string | null
          imagenes?: Json
          meli_item_id?: string | null
          meli_logistic_type?: string | null
          meli_permalink?: string | null
          meli_stock_full?: number | null
          meli_user_product_id?: string | null
          meli_variation_id?: number | null
          nombre: string
          notas?: string | null
          precio?: number | null
          proveedor_id?: string | null
          sku?: string | null
          stock?: number
          stock_minimo?: number
          tiendanube_permalink?: string | null
          tiendanube_product_id?: number | null
          tiendanube_variant_id?: number | null
          tiktok_product_id?: string | null
          tiktok_sku_id?: string | null
          tiktok_stock?: number | null
          tipo?: string
          updated_at?: string | null
          variante?: string | null
        }
        Update: {
          activo?: boolean
          bajo_pedido?: boolean
          costo?: number | null
          created_at?: string
          created_by?: string | null
          descontinuado?: boolean
          id?: string
          imagen_url?: string | null
          imagenes?: Json
          meli_item_id?: string | null
          meli_logistic_type?: string | null
          meli_permalink?: string | null
          meli_stock_full?: number | null
          meli_user_product_id?: string | null
          meli_variation_id?: number | null
          nombre?: string
          notas?: string | null
          precio?: number | null
          proveedor_id?: string | null
          sku?: string | null
          stock?: number
          stock_minimo?: number
          tiendanube_permalink?: string | null
          tiendanube_product_id?: number | null
          tiendanube_variant_id?: number | null
          tiktok_product_id?: string | null
          tiktok_sku_id?: string | null
          tiktok_stock?: number | null
          tipo?: string
          updated_at?: string | null
          variante?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          area: string | null
          color: string
          created_at: string
          empresa_id: string | null
          id: string
          modulos_ocultos: string[]
          nombre: string
          rol: string
          rol_portal: string | null
          ve_agencia: boolean
        }
        Insert: {
          area?: string | null
          color?: string
          created_at?: string
          empresa_id?: string | null
          id: string
          modulos_ocultos?: string[]
          nombre?: string
          rol?: string
          rol_portal?: string | null
          ve_agencia?: boolean
        }
        Update: {
          area?: string | null
          color?: string
          created_at?: string
          empresa_id?: string | null
          id?: string
          modulos_ocultos?: string[]
          nombre?: string
          rol?: string
          rol_portal?: string | null
          ve_agencia?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "profiles_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agencia_empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          ultimo_uso_at: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          ultimo_uso_at?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          ultimo_uso_at?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      recepcion_items: {
        Row: {
          categoria: string | null
          created_at: string
          descontado_en: string | null
          estado: string
          id: string
          producto_id: string | null
          producto_nombre: string | null
          recepcion_id: string
          sku: string
          sku_consolidado: string | null
          talla: string | null
          unidades_no_procesadas: number
          updated_at: string
        }
        Insert: {
          categoria?: string | null
          created_at?: string
          descontado_en?: string | null
          estado?: string
          id?: string
          producto_id?: string | null
          producto_nombre?: string | null
          recepcion_id: string
          sku: string
          sku_consolidado?: string | null
          talla?: string | null
          unidades_no_procesadas?: number
          updated_at?: string
        }
        Update: {
          categoria?: string | null
          created_at?: string
          descontado_en?: string | null
          estado?: string
          id?: string
          producto_id?: string | null
          producto_nombre?: string | null
          recepcion_id?: string
          sku?: string
          sku_consolidado?: string | null
          talla?: string | null
          unidades_no_procesadas?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recepcion_items_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "producto_costos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recepcion_items_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recepcion_items_recepcion_id_fkey"
            columns: ["recepcion_id"]
            isOneToOne: false
            referencedRelation: "recepciones_bodega"
            referencedColumns: ["id"]
          },
        ]
      }
      recepciones_bodega: {
        Row: {
          canal: string
          cerrada_en: string | null
          created_at: string
          created_by: string | null
          estado: string
          id: string
          notas: string | null
          pedido_proveedor_id: string | null
          titulo: string
        }
        Insert: {
          canal?: string
          cerrada_en?: string | null
          created_at?: string
          created_by?: string | null
          estado?: string
          id?: string
          notas?: string | null
          pedido_proveedor_id?: string | null
          titulo: string
        }
        Update: {
          canal?: string
          cerrada_en?: string | null
          created_at?: string
          created_by?: string | null
          estado?: string
          id?: string
          notas?: string | null
          pedido_proveedor_id?: string | null
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "recepciones_bodega_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recepciones_bodega_pedido_proveedor_id_fkey"
            columns: ["pedido_proveedor_id"]
            isOneToOne: false
            referencedRelation: "supplier_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliacion_snapshots: {
        Row: {
          creado_en: string
          id: string
          resumen: Json
        }
        Insert: {
          creado_en?: string
          id?: string
          resumen: Json
        }
        Update: {
          creado_en?: string
          id?: string
          resumen?: Json
        }
        Relationships: []
      }
      reportes: {
        Row: {
          created_at: string
          created_by: string | null
          datos: Json | null
          empresa_id: string | null
          entregado_at: string | null
          generado_at: string | null
          id: string
          periodo_desde: string | null
          periodo_hasta: string | null
          resumen: string | null
          titulo: string
          updated_at: string | null
          url: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          datos?: Json | null
          empresa_id?: string | null
          entregado_at?: string | null
          generado_at?: string | null
          id?: string
          periodo_desde?: string | null
          periodo_hasta?: string | null
          resumen?: string | null
          titulo: string
          updated_at?: string | null
          url?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          datos?: Json | null
          empresa_id?: string | null
          entregado_at?: string | null
          generado_at?: string | null
          id?: string
          periodo_desde?: string | null
          periodo_hasta?: string | null
          resumen?: string | null
          titulo?: string
          updated_at?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agencia_reportes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agencia_reportes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agencia_empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_orders: {
        Row: {
          canal: string
          cliente_id: string | null
          comision: number | null
          costo_envio: number | null
          created_at: string
          cupon: string | null
          descuento: number
          envio: number
          estado: string | null
          fecha: string
          id: string
          impuesto: number
          meses: number | null
          metodo_pago: string | null
          moneda: string
          numero: string | null
          referencia_orden: string
          subtotal: number
          total: number
          updated_at: string | null
        }
        Insert: {
          canal: string
          cliente_id?: string | null
          comision?: number | null
          costo_envio?: number | null
          created_at?: string
          cupon?: string | null
          descuento?: number
          envio?: number
          estado?: string | null
          fecha: string
          id?: string
          impuesto?: number
          meses?: number | null
          metodo_pago?: string | null
          moneda?: string
          numero?: string | null
          referencia_orden: string
          subtotal?: number
          total?: number
          updated_at?: string | null
        }
        Update: {
          canal?: string
          cliente_id?: string | null
          comision?: number | null
          costo_envio?: number | null
          created_at?: string
          cupon?: string | null
          descuento?: number
          envio?: number
          estado?: string | null
          fecha?: string
          id?: string
          impuesto?: number
          meses?: number | null
          metodo_pago?: string | null
          moneda?: string
          numero?: string | null
          referencia_orden?: string
          subtotal?: number
          total?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_orders_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          canal: string
          cantidad: number
          cliente_id: string | null
          created_at: string
          created_by: string | null
          descripcion: string | null
          envio_despachado_en: string | null
          envio_direccion: Json | null
          envio_id: string | null
          envio_limite_despacho: string | null
          estado: string | null
          fecha: string
          id: string
          monto: number
          notas: string | null
          num_guia: string | null
          origen: string
          paqueteria: string | null
          producto_id: string | null
          rastreo_detalle: string | null
          rastreo_en: string | null
          rastreo_estado: string | null
          referencia_externa: string | null
          updated_at: string | null
          url_orden: string | null
          url_rastreo: string | null
        }
        Insert: {
          canal?: string
          cantidad?: number
          cliente_id?: string | null
          created_at?: string
          created_by?: string | null
          descripcion?: string | null
          envio_despachado_en?: string | null
          envio_direccion?: Json | null
          envio_id?: string | null
          envio_limite_despacho?: string | null
          estado?: string | null
          fecha?: string
          id?: string
          monto?: number
          notas?: string | null
          num_guia?: string | null
          origen?: string
          paqueteria?: string | null
          producto_id?: string | null
          rastreo_detalle?: string | null
          rastreo_en?: string | null
          rastreo_estado?: string | null
          referencia_externa?: string | null
          updated_at?: string | null
          url_orden?: string | null
          url_rastreo?: string | null
        }
        Update: {
          canal?: string
          cantidad?: number
          cliente_id?: string | null
          created_at?: string
          created_by?: string | null
          descripcion?: string | null
          envio_despachado_en?: string | null
          envio_direccion?: Json | null
          envio_id?: string | null
          envio_limite_despacho?: string | null
          estado?: string | null
          fecha?: string
          id?: string
          monto?: number
          notas?: string | null
          num_guia?: string | null
          origen?: string
          paqueteria?: string | null
          producto_id?: string | null
          rastreo_detalle?: string | null
          rastreo_en?: string | null
          rastreo_estado?: string | null
          referencia_externa?: string | null
          updated_at?: string | null
          url_orden?: string | null
          url_rastreo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "producto_costos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_canal: {
        Row: {
          producto_id: string
          stock_crm: number | null
          stock_ml: number | null
          stock_tn: number | null
          visto_en: string
        }
        Insert: {
          producto_id: string
          stock_crm?: number | null
          stock_ml?: number | null
          stock_tn?: number | null
          visto_en?: string
        }
        Update: {
          producto_id?: string
          stock_crm?: number | null
          stock_ml?: number | null
          stock_tn?: number | null
          visto_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_canal_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: true
            referencedRelation: "producto_costos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_canal_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_canal_log: {
        Row: {
          detectado_en: string
          id: number
          producto_id: string | null
          stock_crm: number | null
          stock_crm_ant: number | null
          stock_ml: number | null
          stock_ml_ant: number | null
          stock_tn: number | null
          stock_tn_ant: number | null
        }
        Insert: {
          detectado_en?: string
          id?: never
          producto_id?: string | null
          stock_crm?: number | null
          stock_crm_ant?: number | null
          stock_ml?: number | null
          stock_ml_ant?: number | null
          stock_tn?: number | null
          stock_tn_ant?: number | null
        }
        Update: {
          detectado_en?: string
          id?: never
          producto_id?: string | null
          stock_crm?: number | null
          stock_crm_ant?: number | null
          stock_ml?: number | null
          stock_ml_ant?: number | null
          stock_tn?: number | null
          stock_tn_ant?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_canal_log_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "producto_costos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_canal_log_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_locks: {
        Row: {
          expira_en: string
          producto_id: string
          tomado_en: string
        }
        Insert: {
          expira_en: string
          producto_id: string
          tomado_en?: string
        }
        Update: {
          expira_en?: string
          producto_id?: string
          tomado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_locks_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: true
            referencedRelation: "producto_costos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_locks_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_log: {
        Row: {
          canal: string
          creado_en: string
          created_by: string | null
          id: number
          lote: string | null
          origen: string
          producto_id: string | null
          simulado: boolean
          stock_anterior: number | null
          stock_nuevo: number
        }
        Insert: {
          canal: string
          creado_en?: string
          created_by?: string | null
          id?: never
          lote?: string | null
          origen: string
          producto_id?: string | null
          simulado?: boolean
          stock_anterior?: number | null
          stock_nuevo: number
        }
        Update: {
          canal?: string
          creado_en?: string
          created_by?: string | null
          id?: never
          lote?: string | null
          origen?: string
          producto_id?: string | null
          simulado?: boolean
          stock_anterior?: number | null
          stock_nuevo?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_log_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_log_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "producto_costos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_log_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_order_incidents: {
        Row: {
          created_at: string
          created_by: string | null
          fecha: string
          id: string
          pedido_id: string
          resuelto: boolean
          texto: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          fecha?: string
          id?: string
          pedido_id: string
          resuelto?: boolean
          texto: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          fecha?: string
          id?: string
          pedido_id?: string
          resuelto?: boolean
          texto?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_order_incidents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_order_incidents_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "supplier_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_order_items: {
        Row: {
          cantidad: number
          costo_unitario: number | null
          descripcion: string | null
          id: string
          pedido_id: string
          producto_id: string | null
        }
        Insert: {
          cantidad: number
          costo_unitario?: number | null
          descripcion?: string | null
          id?: string
          pedido_id: string
          producto_id?: string | null
        }
        Update: {
          cantidad?: number
          costo_unitario?: number | null
          descripcion?: string | null
          id?: string
          pedido_id?: string
          producto_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_order_items_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "supplier_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_order_items_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "producto_costos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_order_items_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_order_payments: {
        Row: {
          comprobante_nombre: string | null
          comprobante_path: string | null
          comprobante_tipo: string | null
          created_at: string
          created_by: string | null
          fecha: string
          id: string
          monto: number
          nota: string | null
          pedido_id: string
        }
        Insert: {
          comprobante_nombre?: string | null
          comprobante_path?: string | null
          comprobante_tipo?: string | null
          created_at?: string
          created_by?: string | null
          fecha?: string
          id?: string
          monto: number
          nota?: string | null
          pedido_id: string
        }
        Update: {
          comprobante_nombre?: string | null
          comprobante_path?: string | null
          comprobante_tipo?: string | null
          created_at?: string
          created_by?: string | null
          fecha?: string
          id?: string
          monto?: number
          nota?: string | null
          pedido_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_order_payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_order_payments_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "supplier_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_orders: {
        Row: {
          costo_total: number | null
          created_at: string
          created_by: string | null
          estado: string
          fecha_estimada: string | null
          fecha_pedido: string
          id: string
          notas: string | null
          num_guia: string | null
          paqueteria: string | null
          proveedor_id: string
          updated_at: string | null
          url_rastreo: string | null
        }
        Insert: {
          costo_total?: number | null
          created_at?: string
          created_by?: string | null
          estado?: string
          fecha_estimada?: string | null
          fecha_pedido?: string
          id?: string
          notas?: string | null
          num_guia?: string | null
          paqueteria?: string | null
          proveedor_id: string
          updated_at?: string | null
          url_rastreo?: string | null
        }
        Update: {
          costo_total?: number | null
          created_at?: string
          created_by?: string | null
          estado?: string
          fecha_estimada?: string | null
          fecha_pedido?: string
          id?: string
          notas?: string | null
          num_guia?: string | null
          paqueteria?: string | null
          proveedor_id?: string
          updated_at?: string | null
          url_rastreo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_orders_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          contacto: string | null
          correo: string | null
          created_at: string
          created_by: string | null
          dias_entrega: number | null
          id: string
          nombre: string
          notas: string | null
          pais: string | null
          telefono: string | null
          updated_at: string | null
        }
        Insert: {
          contacto?: string | null
          correo?: string | null
          created_at?: string
          created_by?: string | null
          dias_entrega?: number | null
          id?: string
          nombre: string
          notas?: string | null
          pais?: string | null
          telefono?: string | null
          updated_at?: string | null
        }
        Update: {
          contacto?: string | null
          correo?: string | null
          created_at?: string
          created_by?: string | null
          dias_entrega?: number | null
          id?: string
          nombre?: string
          notas?: string | null
          pais?: string | null
          telefono?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_activity: {
        Row: {
          autor: string | null
          created_at: string
          id: string
          task_id: string
          texto: string
        }
        Insert: {
          autor?: string | null
          created_at?: string
          id?: string
          task_id: string
          texto: string
        }
        Update: {
          autor?: string | null
          created_at?: string
          id?: string
          task_id?: string
          texto?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_activity_autor_fkey"
            columns: ["autor"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_activity_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_assignees: {
        Row: {
          created_at: string
          task_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          task_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_assignees_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_attachments: {
        Row: {
          autor: string | null
          created_at: string
          id: string
          nombre: string
          storage_path: string
          task_id: string
          tipo: string | null
        }
        Insert: {
          autor?: string | null
          created_at?: string
          id?: string
          nombre: string
          storage_path: string
          task_id: string
          tipo?: string | null
        }
        Update: {
          autor?: string | null
          created_at?: string
          id?: string
          nombre?: string
          storage_path?: string
          task_id?: string
          tipo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_attachments_autor_fkey"
            columns: ["autor"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_attachments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_checklist: {
        Row: {
          created_at: string
          hecho: boolean
          id: string
          orden: number
          task_id: string
          texto: string
        }
        Insert: {
          created_at?: string
          hecho?: boolean
          id?: string
          orden?: number
          task_id: string
          texto: string
        }
        Update: {
          created_at?: string
          hecho?: boolean
          id?: string
          orden?: number
          task_id?: string
          texto?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_checklist_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_comments: {
        Row: {
          autor: string | null
          created_at: string
          id: string
          task_id: string
          texto: string
        }
        Insert: {
          autor?: string | null
          created_at?: string
          id?: string
          task_id: string
          texto: string
        }
        Update: {
          autor?: string | null
          created_at?: string
          id?: string
          task_id?: string
          texto?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_autor_fkey"
            columns: ["autor"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_links: {
        Row: {
          created_at: string
          id: string
          task_id: string
          titulo: string | null
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          task_id: string
          titulo?: string | null
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          task_id?: string
          titulo?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_links_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_reads: {
        Row: {
          leido_at: string
          task_id: string
          user_id: string
        }
        Insert: {
          leido_at?: string
          task_id: string
          user_id: string
        }
        Update: {
          leido_at?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_reads_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_shares: {
        Row: {
          task_id: string
          user_id: string
        }
        Insert: {
          task_id: string
          user_id: string
        }
        Update: {
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_shares_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_shares_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          area: string
          categoria: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          descripcion: string | null
          empresa_id: string | null
          espacio: string
          estado: string
          etiquetas: string[]
          fecha_inicio: string | null
          fecha_limite: string | null
          id: string
          motivo_atorado: string | null
          orden: number
          prioridad: string
          recordatorio_at: string | null
          recordatorio_enviado: boolean
          responsable_id: string | null
          titulo: string
          ultima_actividad_at: string | null
          updated_at: string | null
          visibilidad: string
        }
        Insert: {
          area?: string
          categoria?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          descripcion?: string | null
          empresa_id?: string | null
          espacio?: string
          estado?: string
          etiquetas?: string[]
          fecha_inicio?: string | null
          fecha_limite?: string | null
          id?: string
          motivo_atorado?: string | null
          orden?: number
          prioridad?: string
          recordatorio_at?: string | null
          recordatorio_enviado?: boolean
          responsable_id?: string | null
          titulo: string
          ultima_actividad_at?: string | null
          updated_at?: string | null
          visibilidad?: string
        }
        Update: {
          area?: string
          categoria?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          descripcion?: string | null
          empresa_id?: string | null
          espacio?: string
          estado?: string
          etiquetas?: string[]
          fecha_inicio?: string | null
          fecha_limite?: string | null
          id?: string
          motivo_atorado?: string | null
          orden?: number
          prioridad?: string
          recordatorio_at?: string | null
          recordatorio_enviado?: boolean
          responsable_id?: string | null
          titulo?: string
          ultima_actividad_at?: string | null
          updated_at?: string | null
          visibilidad?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "agencia_empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_responsable_id_fkey"
            columns: ["responsable_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tiktok_publicaciones: {
        Row: {
          creado_en: string
          id: number
          principal: boolean
          producto_id: string
          tiktok_product_id: string
          tiktok_sku_id: string
        }
        Insert: {
          creado_en?: string
          id?: never
          principal?: boolean
          producto_id: string
          tiktok_product_id: string
          tiktok_sku_id: string
        }
        Update: {
          creado_en?: string
          id?: never
          principal?: boolean
          producto_id?: string
          tiktok_product_id?: string
          tiktok_sku_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tiktok_publicaciones_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "producto_costos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tiktok_publicaciones_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      maquila_anticipos_saldo: {
        Row: {
          anticipo_id: string | null
          aplicado: number | null
          monto: number | null
          saldo: number | null
        }
        Relationships: []
      }
      producto_costos: {
        Row: {
          costo: number | null
          id: string | null
        }
        Insert: {
          costo?: never
          id?: string | null
        }
        Update: {
          costo?: never
          id?: string | null
        }
        Relationships: []
      }
      ventas_montos: {
        Row: {
          id: string | null
          monto: number | null
        }
        Insert: {
          id?: string | null
          monto?: never
        }
        Update: {
          id?: string | null
          monto?: never
        }
        Relationships: []
      }
    }
    Functions: {
      _fusionar_fichas: {
        Args: { p_ganador: string; p_perdedor: string }
        Returns: undefined
      }
      armar_conjunto: {
        Args: { cid: string; n: number; p_nota?: string }
        Returns: string
      }
      avanzar_estado_pedido: {
        Args: { actual: string; entrante: string }
        Returns: string
      }
      conteo_ventas_por_producto: {
        Args: { ids: string[] }
        Returns: {
          producto_id: string
          ventas: number
        }[]
      }
      costos_canal: { Args: { canal_f: string; desde: string }; Returns: Json }
      desarmar_conjunto: { Args: { aid: string }; Returns: string }
      descontar_recepcion: { Args: { iid: string }; Returns: undefined }
      descontar_recepcion_lote: { Args: { rid: string }; Returns: number }
      descontar_stock_tiktok: {
        Args: { items: Json; p_origen?: string }
        Returns: {
          almacen: string
          anterior: number
          movido: number
          nuevo: number
          producto: string
          sku: string
        }[]
      }
      descontar_stock_ventas: {
        Args: { items: Json; p_origen: string }
        Returns: {
          bajo_pedido: boolean
          descontado: number
          id: string
          meli_item_id: string
          meli_logistic_type: string
          meli_variation_id: number
          sku: string
          stock: number
          tiendanube_product_id: number
          tiendanube_variant_id: number
        }[]
      }
      devolver_stock_tiktok: {
        Args: { items: Json; p_origen?: string }
        Returns: {
          almacen: string
          anterior: number
          movido: number
          nuevo: number
          producto: string
          sku: string
        }[]
      }
      devolver_stock_ventas: {
        Args: { items: Json; p_origen: string }
        Returns: {
          bajo_pedido: boolean
          devuelto: number
          id: string
          meli_item_id: string
          meli_logistic_type: string
          meli_variation_id: number
          sku: string
          stock: number
          tiendanube_product_id: number
          tiendanube_variant_id: number
        }[]
      }
      es_admin: { Args: { uid: string }; Returns: boolean }
      es_administrativo: { Args: never; Returns: boolean }
      es_asignado_tarea: { Args: { tid: string }; Returns: boolean }
      es_externo: { Args: never; Returns: boolean }
      es_externo_admin: { Args: never; Returns: boolean }
      es_gestor: { Args: never; Returns: boolean }
      es_interno: { Args: never; Returns: boolean }
      es_maquilero: { Args: never; Returns: boolean }
      etiqueta_estado: { Args: { e: string }; Returns: string }
      fusionar_producto_ml: {
        Args: { p_ganador: string; p_perdedor: string }
        Returns: undefined
      }
      fusionar_producto_tiktok: {
        Args: { p_ganador: string; p_perdedor: string }
        Returns: undefined
      }
      ingresos_por_dia: {
        Args: { desde: string }
        Returns: {
          fecha: string
          total: number
        }[]
      }
      liberar_candado_stock: {
        Args: { p_producto: string }
        Returns: undefined
      }
      maquila_agregar_ajuste_corte: {
        Args: { cid: string; p_concepto: string; p_importe: number }
        Returns: string
      }
      maquila_ajustar_consignacion: {
        Args: { iid: string; p_motivo: string; saldo_nuevo: number }
        Returns: number
      }
      maquila_calcular_corte: {
        Args: { desde: string; hasta: string }
        Returns: string
      }
      maquila_cancelar_corte: { Args: { cid: string }; Returns: undefined }
      maquila_cerrar_corte: { Args: { cid: string }; Returns: undefined }
      maquila_devolver_insumo: {
        Args: { iid: string; n: number; p_motivo?: string }
        Returns: number
      }
      maquila_enviar_insumo: {
        Args: { iid: string; n: number; p_motivo?: string }
        Returns: number
      }
      maquila_fijar_costo_pedido: {
        Args: { p_fecha?: string; pid: string }
        Returns: undefined
      }
      maquila_rango_estado: { Args: { e: string }; Returns: number }
      maquila_rango_subestado: { Args: { s: string }; Returns: number }
      maquila_recalcular_totales: { Args: { cid: string }; Returns: undefined }
      maquilero_ve_carpeta_maquila: { Args: { ruta: string }; Returns: boolean }
      maquilero_ve_personalizado: { Args: { pid: string }; Returns: boolean }
      marcar_conjunto_subido: { Args: { cid: string }; Returns: number }
      metricas_resumen: {
        Args: { canal_f?: string; desde: string; hasta: string }
        Returns: Json
      }
      mi_area: { Args: never; Returns: string }
      mi_empresa: { Args: never; Returns: string }
      mi_rol: { Args: never; Returns: string }
      mover_insumo: {
        Args: {
          iid: string
          p_cantidad: number
          p_motivo: string
          p_tipo: string
        }
        Returns: number
      }
      mover_stock_tiktok: {
        Args: { items: Json; p_origen: string; p_signo: number }
        Returns: {
          almacen: string
          anterior: number
          movido: number
          nuevo: number
          producto: string
          sku: string
        }[]
      }
      pagos_canal: { Args: { canal_f: string; desde: string }; Returns: Json }
      puede_contribuir_tarea: { Args: { tid: string }; Returns: boolean }
      puede_gestionar_tarea: { Args: { tid: string }; Returns: boolean }
      puede_mover_insumos: { Args: never; Returns: boolean }
      puede_ver_bitacora: { Args: { bid: string }; Returns: boolean }
      puede_ver_documento: { Args: { did: string }; Returns: boolean }
      puede_ver_tarea: { Args: { tid: string }; Returns: boolean }
      purgar_logs: { Args: { solo_contar?: boolean }; Returns: Json }
      rango_estado_pedido: { Args: { e: string }; Returns: number }
      recibir_pedido_proveedor: {
        Args: { pid: string; sumar_stock: boolean }
        Returns: undefined
      }
      reporte_fresafit: {
        Args: {
          desde: string
          desde_prev: string
          hasta: string
          hasta_prev: string
          limite_atraso: string
        }
        Returns: Json
      }
      siguiente_version_documento: { Args: { did: string }; Returns: number }
      sincronizar_renglones_venta: {
        Args: { p_canal: string; p_filas: Json }
        Returns: number
      }
      stats_por_cliente: {
        Args: never
        Returns: {
          cliente_id: string
          compras: number
          total: number
          ultima: string
        }[]
      }
      tomar_candado_stock: {
        Args: { p_producto: string; p_segundos?: number }
        Returns: boolean
      }
      unidades_en_camino: {
        Args: never
        Returns: {
          producto_id: string
          unidades: number
        }[]
      }
      ve_dinero_canal: { Args: { canal_f: string }; Returns: boolean }
      ve_egresos: { Args: never; Returns: boolean }
      ve_ingresos: { Args: never; Returns: boolean }
      ventas_reorden: {
        Args: { desde: string }
        Returns: {
          canal: string
          cantidad: number
          fecha: string
          producto_id: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
