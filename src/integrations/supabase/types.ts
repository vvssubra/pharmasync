export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      ai_audit_logs: {
        Row: {
          created_at: string
          error_message: string | null
          function_name: string
          id: string
          role: string
          status_code: number
          tokens_used: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          function_name: string
          id?: string
          role: string
          status_code: number
          tokens_used?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          function_name?: string
          id?: string
          role?: string
          status_code?: number
          tokens_used?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      antibiotic_forms: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          antibiotic_regimen: string | null
          assigned_fms: string | null
          checklist_data: Json | null
          clinic_id: string
          created_at: string | null
          diagnosis: string
          drug_allergy: boolean | null
          drug_allergy_detail: string | null
          fms_code: string | null
          health_ed_compliance: boolean | null
          health_ed_sideeffect: boolean | null
          health_ed_tca: boolean | null
          id: string
          pathway_check_result: string | null
          patient_ic: string
          patient_name: string
          patient_weight_kg: number | null
          prescriber_notes: string | null
          prescription_unit: string | null
          specialist_action_at: string | null
          specialist_id: string | null
          specialist_notes: string | null
          status: string | null
          submitted_by: string | null
          tarikh: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          antibiotic_regimen?: string | null
          assigned_fms?: string | null
          checklist_data?: Json | null
          clinic_id?: string
          created_at?: string | null
          diagnosis: string
          drug_allergy?: boolean | null
          drug_allergy_detail?: string | null
          fms_code?: string | null
          health_ed_compliance?: boolean | null
          health_ed_sideeffect?: boolean | null
          health_ed_tca?: boolean | null
          id?: string
          pathway_check_result?: string | null
          patient_ic: string
          patient_name: string
          patient_weight_kg?: number | null
          prescriber_notes?: string | null
          prescription_unit?: string | null
          specialist_action_at?: string | null
          specialist_id?: string | null
          specialist_notes?: string | null
          status?: string | null
          submitted_by?: string | null
          tarikh: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          antibiotic_regimen?: string | null
          assigned_fms?: string | null
          checklist_data?: Json | null
          clinic_id?: string
          created_at?: string | null
          diagnosis?: string
          drug_allergy?: boolean | null
          drug_allergy_detail?: string | null
          fms_code?: string | null
          health_ed_compliance?: boolean | null
          health_ed_sideeffect?: boolean | null
          health_ed_tca?: boolean | null
          id?: string
          pathway_check_result?: string | null
          patient_ic?: string
          patient_name?: string
          patient_weight_kg?: number | null
          prescriber_notes?: string | null
          prescription_unit?: string | null
          specialist_action_at?: string | null
          specialist_id?: string | null
          specialist_notes?: string | null
          status?: string | null
          submitted_by?: string | null
          tarikh?: string
        }
        Relationships: [
          {
            foreignKeyName: "antibiotic_forms_clinic_id_fkey"
            columns: ["clinic_id"]
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      clinics: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      dispensing_requests: {
        Row: {
          borrowed_from_clinic_id: string | null
          clinic_id: string
          created_at: string
          deferred_date: string | null
          drug_id: string
          fulfilled_at: string | null
          fulfilled_by: string | null
          id: string
          is_pesara: boolean
          no_ic: string
          patient_name: string
          prescriber_name: string
          quantity: number
          rejection_reason: string | null
          specialist_action_at: string | null
          specialist_id: string | null
          specialist_notes: string | null
          status: string
          submitted_by: string | null
          updated_at: string
        }
        Insert: {
          borrowed_from_clinic_id?: string | null
          clinic_id?: string
          created_at?: string
          deferred_date?: string | null
          drug_id: string
          fulfilled_at?: string | null
          fulfilled_by?: string | null
          id?: string
          is_pesara?: boolean
          no_ic: string
          patient_name: string
          prescriber_name: string
          quantity: number
          rejection_reason?: string | null
          specialist_action_at?: string | null
          specialist_id?: string | null
          specialist_notes?: string | null
          status?: string
          submitted_by?: string | null
          updated_at?: string
        }
        Update: {
          borrowed_from_clinic_id?: string | null
          clinic_id?: string
          created_at?: string
          deferred_date?: string | null
          drug_id?: string
          fulfilled_at?: string | null
          fulfilled_by?: string | null
          id?: string
          is_pesara?: boolean
          no_ic?: string
          patient_name?: string
          prescriber_name?: string
          quantity?: number
          rejection_reason?: string | null
          specialist_action_at?: string | null
          specialist_id?: string | null
          specialist_notes?: string | null
          status?: string
          submitted_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dispensing_requests_borrowed_from_clinic_id_fkey"
            columns: ["borrowed_from_clinic_id"]
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispensing_requests_clinic_id_fkey"
            columns: ["clinic_id"]
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispensing_requests_drug_id_fkey"
            columns: ["drug_id"]
            referencedRelation: "drugs"
            referencedColumns: ["id"]
          },
        ]
      }
      drug_quotas: {
        Row: {
          alert_threshold_pct: number
          clinic_id: string
          created_by: string | null
          drug_id: string
          id: string
          quota_limit: number
          updated_at: string
          year: number
        }
        Insert: {
          alert_threshold_pct?: number
          clinic_id?: string
          created_by?: string | null
          drug_id: string
          id?: string
          quota_limit: number
          updated_at?: string
          year: number
        }
        Update: {
          alert_threshold_pct?: number
          clinic_id?: string
          created_by?: string | null
          drug_id?: string
          id?: string
          quota_limit?: number
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "drug_quotas_clinic_id_fkey"
            columns: ["clinic_id"]
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drug_quotas_drug_id_fkey"
            columns: ["drug_id"]
            referencedRelation: "drugs"
            referencedColumns: ["id"]
          },
        ]
      }
      drugs: {
        Row: {
          created_at: string
          created_by: string | null
          drug_name: string
          id: string
          is_active: boolean
          is_blocked: boolean
          kumpulan: string | null
          no_kod: string | null
          pergerakan: string | null
          perlu_kelulusan_pakar: boolean
          stok_max: number | null
          stok_min: number | null
          stok_reorder: number | null
          unit_pengukuran: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          drug_name: string
          id?: string
          is_active?: boolean
          is_blocked?: boolean
          kumpulan?: string | null
          no_kod?: string | null
          pergerakan?: string | null
          perlu_kelulusan_pakar?: boolean
          stok_max?: number | null
          stok_min?: number | null
          stok_reorder?: number | null
          unit_pengukuran?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          drug_name?: string
          id?: string
          is_active?: boolean
          is_blocked?: boolean
          kumpulan?: string | null
          no_kod?: string | null
          pergerakan?: string | null
          perlu_kelulusan_pakar?: boolean
          stok_max?: number | null
          stok_min?: number | null
          stok_reorder?: number | null
          unit_pengukuran?: string
          updated_at?: string
        }
        Relationships: []
      }
      patient_drug_history: {
        Row: {
          clinic_id: string
          created_at: string
          dispensed_at: string
          drug_id: string
          id: string
          method: string
          officer_name: string | null
          patient_id: string
          quantity: number
          stock_after: number | null
        }
        Insert: {
          clinic_id?: string
          created_at?: string
          dispensed_at?: string
          drug_id: string
          id?: string
          method?: string
          officer_name?: string | null
          patient_id: string
          quantity: number
          stock_after?: number | null
        }
        Update: {
          clinic_id?: string
          created_at?: string
          dispensed_at?: string
          drug_id?: string
          id?: string
          method?: string
          officer_name?: string | null
          patient_id?: string
          quantity?: number
          stock_after?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "patient_drug_history_clinic_id_fkey"
            columns: ["clinic_id"]
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_drug_history_drug_id_fkey"
            columns: ["drug_id"]
            referencedRelation: "drugs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_drug_history_patient_id_fkey"
            columns: ["patient_id"]
            referencedRelation: "patient_registry"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_registry: {
        Row: {
          clinic_id: string
          created_at: string
          id: string
          no_ic: string
          patient_name: string
          updated_at: string
        }
        Insert: {
          clinic_id?: string
          created_at?: string
          id?: string
          no_ic: string
          patient_name: string
          updated_at?: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          id?: string
          no_ic?: string
          patient_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_registry_clinic_id_fkey"
            columns: ["clinic_id"]
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          clinic_id: string | null
          created_at: string
          full_name: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          clinic_id?: string | null
          created_at?: string
          full_name?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          clinic_id?: string | null
          created_at?: string
          full_name?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_clinic_id_fkey"
            columns: ["clinic_id"]
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          catatan: string | null
          clinic_id: string
          created_at: string
          created_by: string | null
          drug_id: string
          harga_seunit: number | null
          id: string
          jenis: string
          jenis_rujukan: string | null
          jumlah_rm: number | null
          kuantiti: number
          nama_pegawai: string | null
          nama_pesakit: string | null
          no_ic: string | null
          no_rujukan: string | null
          sumber: string | null
          tarikh: string
          terima_daripada: string | null
          updated_at: string
        }
        Insert: {
          catatan?: string | null
          clinic_id?: string
          created_at?: string
          created_by?: string | null
          drug_id: string
          harga_seunit?: number | null
          id?: string
          jenis: string
          jenis_rujukan?: string | null
          jumlah_rm?: number | null
          kuantiti: number
          nama_pegawai?: string | null
          nama_pesakit?: string | null
          no_ic?: string | null
          no_rujukan?: string | null
          sumber?: string | null
          tarikh: string
          terima_daripada?: string | null
          updated_at?: string
        }
        Update: {
          catatan?: string | null
          clinic_id?: string
          created_at?: string
          created_by?: string | null
          drug_id?: string
          harga_seunit?: number | null
          id?: string
          jenis?: string
          jenis_rujukan?: string | null
          jumlah_rm?: number | null
          kuantiti?: number
          nama_pegawai?: string | null
          nama_pesakit?: string | null
          no_ic?: string | null
          no_rujukan?: string | null
          sumber?: string | null
          tarikh?: string
          terima_daripada?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_clinic_id_fkey"
            columns: ["clinic_id"]
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_drug_id_fkey"
            columns: ["drug_id"]
            referencedRelation: "drugs"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_all_users_with_roles: {
        Args: never
        Returns: {
          clinic_id: string
          clinic_name: string
          email: string
          full_name: string
          role: string
          user_id: string
        }[]
      }
      get_unassigned_user_count: { Args: never; Returns: number }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_pharmacist: { Args: never; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      user_clinic_id: { Args: never; Returns: string }
    }
    Enums: {
      app_role:
        | "admin"
        | "pharmacist"
        | "staff"
        | "doctor"
        | "specialist"
        | "fms"
        | "mo"
        | "super_admin"
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
    Enums: {
      app_role: [
        "admin",
        "pharmacist",
        "staff",
        "doctor",
        "specialist",
        "fms",
        "mo",
        "super_admin",
      ],
    },
  },
} as const
