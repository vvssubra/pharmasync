import { createContext, useContext, useEffect, useState, useRef, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

export type AppRole = "admin" | "fms" | "mo" | "pharmacist" | "specialist" | "super_admin";

interface Profile {
  full_name: string;
  clinic_id: string | null;
  clinic_name: string;
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  role: AppRole | null;
  loading: boolean;
  authError: string | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const ALLOWED_EMAIL_DOMAIN = "moh.gov.my";

function isAllowedEmail(email: string | null | undefined) {
  return !!email && email.toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
}

async function loadProfileAndRole(
  userId: string,
  setProfile: (p: Profile | null) => void,
  setRole: (r: AppRole | null) => void,
  setLoading: (v: boolean) => void
) {
  try {
    const { data: profileData } = await supabase
      .from("profiles")
      .select("full_name, clinic_id, clinics(name)")
      .eq("user_id", userId)
      .maybeSingle();

    if (profileData) {
      setProfile({
        full_name: profileData.full_name,
        clinic_id: profileData.clinic_id,
        clinic_name: profileData.clinics?.name ?? "",
      });
    }

    const { data: roleData, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();

    if (roleError) console.error("[Auth] role query error:", roleError);
    if (roleData) setRole(roleData.role as AppRole);
  } catch (err) {
    console.error("[Auth] loadProfileAndRole failed:", err);
  } finally {
    setLoading(false);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const loadingForUser = useRef<string | null>(null);

  useEffect(() => {
    function handleSession(sess: Session | null) {
      if (sess?.user?.app_metadata?.provider === "google" && !isAllowedEmail(sess.user.email)) {
        setAuthError(`Only @${ALLOWED_EMAIL_DOMAIN} Google accounts are allowed.`);
        setSession(null);
        setUser(null);
        setProfile(null);
        setRole(null);
        setLoading(false);
        loadingForUser.current = null;
        supabase.auth.signOut();
        return;
      }

      setAuthError(null);
      setSession(sess);
      setUser(sess?.user ?? null);
      if (!sess?.user) {
        setProfile(null);
        setRole(null);
        setLoading(false);
        loadingForUser.current = null;
        return;
      }
      const uid = sess.user.id;
      if (loadingForUser.current === uid) return;
      loadingForUser.current = uid;
      setLoading(true);
      loadProfileAndRole(uid, setProfile, setRole, setLoading);
    }

    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      handleSession(initialSession);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      handleSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, profile, role, loading, authError, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
