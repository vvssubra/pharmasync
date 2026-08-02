import { createContext, useContext, useEffect, useState, useRef, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

export type AppRole = "admin" | "fms" | "mo" | "pharmacist" | "specialist" | "super_admin";

interface Profile {
  full_name: string;
  clinic_id: string | null;
  clinic_name: string;
  // The clinic the user asked for. A request, not a grant — an admin promotes
  // it to clinic_id. Null for OAuth signups, which carry no clinic metadata.
  pending_clinic_id: string | null;
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  role: AppRole | null;
  loading: boolean;
  authError: string | null;
  // The account's password was set by an admin (create_user / reset_password
  // stamp user_metadata.must_change_password). ProtectedRoute holds the user on
  // /change-password until they replace it. A first-login prompt, not a
  // security boundary: user_metadata is writable by its own user.
  mustChangePassword: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const ALLOWED_EMAIL_DOMAIN = "moh.gov.my";

function isAllowedEmail(email: string | null | undefined) {
  return !!email && email.toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
}

// Whether THIS session was authenticated via OAuth, read from the JWT's amr
// (authentication method reference; most recent method first). The account's
// app_metadata.provider is wrong for this check: it names the provider that
// created the account, so a user who once tried Google sign-in but now logs
// in with an admin-set password would be blocked forever.
function sessionUsedOAuth(sess: Session): boolean {
  try {
    const payload = JSON.parse(atob(sess.access_token.split(".")[1]));
    const amr = payload?.amr;
    if (Array.isArray(amr) && amr.length > 0) {
      return amr[0]?.method === "oauth";
    }
  } catch {
    // fall through to the provider check below
  }
  // No amr claim (older GoTrue) or unparseable token: fall back to the
  // account-level provider so the domain block fails closed, not open.
  return sess.user?.app_metadata?.provider === "google";
}

async function loadProfileAndRole(
  userId: string,
  setProfile: (p: Profile | null) => void,
  setRole: (r: AppRole | null) => void,
  setLoading: (v: boolean) => void
) {
  try {
    // The embed names its foreign key explicitly: profiles has two FKs to
    // clinics (clinic_id and pending_clinic_id), and PostgREST refuses an
    // ambiguous embed rather than picking one.
    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .select("full_name, clinic_id, pending_clinic_id, clinics!profiles_clinic_id_fkey(name)")
      .eq("user_id", userId)
      .maybeSingle();

    if (profileError) console.error("[Auth] profile query error:", profileError);

    if (profileData) {
      setProfile({
        full_name: profileData.full_name,
        clinic_id: profileData.clinic_id,
        clinic_name: profileData.clinics?.name ?? "",
        pending_clinic_id: profileData.pending_clinic_id ?? null,
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
      if (sess?.user && sessionUsedOAuth(sess) && !isAllowedEmail(sess.user.email)) {
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

  // Re-reads profile and role for the signed-in user. Needed after the user
  // changes their own profile — requesting a clinic — so the gate in
  // ProtectedRoute re-evaluates without a page reload.
  const refreshProfile = async () => {
    if (!user) return;
    await loadProfileAndRole(user.id, setProfile, setRole, setLoading);
  };

  const mustChangePassword = user?.user_metadata?.must_change_password === true;

  return (
    <AuthContext.Provider
      value={{ user, session, profile, role, loading, authError, mustChangePassword, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
