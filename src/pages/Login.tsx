import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, Loader2, Lock, Pill, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PharmaMatrix from "@/components/ui/pharma-matrix";

export default function Login() {
  const { user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [clinicId, setClinicId] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Clinic picker for signup — clinics table is anon-readable so this loads
  // before the user is authenticated.
  const { data: clinics } = useQuery({
    queryKey: ["clinics-signup"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clinics").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#04140d]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-7 w-7 animate-spin text-emerald-300" />
          <p className="text-sm text-emerald-100/60">Loading…</p>
        </div>
      </div>
    );
  }

  if (user) return <Navigate to="/" replace />;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setSubmitting(false);
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, clinic_id: clinicId } },
    });
    if (error) setError(error.message);
    setSubmitting(false);
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setGoogleLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/` },
    });
    if (error) setError(error.message);
    setGoogleLoading(false);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setForgotLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      setError(error.message);
    } else {
      setForgotSent(true);
    }
    setForgotLoading(false);
  };

  const inputClass =
    "h-11 border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 " +
    "focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500";
  const labelClass = "text-[13px] font-medium text-slate-700";
  const primaryBtn =
    "h-11 w-full bg-emerald-600 text-[15px] font-semibold text-white hover:bg-emerald-700";

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* ── Brand panel (desktop) ─────────────────────────────── */}
      <aside className="relative hidden w-[46%] max-w-[620px] flex-col justify-between overflow-hidden bg-[#04140d] px-12 py-11 text-white lg:flex">
        {/* Depth wash */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 90% at 15% 0%, #0b3b28 0%, #073221 42%, #04140d 100%)",
          }}
        />
        {/* Interactive emerald pharma matrix */}
        <PharmaMatrix variant="dark" />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -left-24 h-[460px] w-[460px] rounded-full opacity-40"
          style={{ background: "radial-gradient(circle, #10b981 0%, transparent 70%)", filter: "blur(70px)" }}
        />

        {/* Identity */}
        <div className="pointer-events-none relative z-10 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-300/20 bg-emerald-400/10 backdrop-blur-sm">
            <Pill className="h-6 w-6 text-emerald-300" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold tracking-wide">KLINIK KESIHATAN KEMPAS</p>
            <p className="text-xs text-emerald-200/60">PEJABAT KESIHATAN JOHOR BAHRU</p>
          </div>
        </div>

        {/* Headline */}
        <div className="pointer-events-none relative z-10 max-w-md">
          <h1
            className="shimmer-emerald-on-dark text-6xl font-bold leading-[1.05] tracking-tight"
            style={{ textWrap: "balance" as never }}
          >
            PharmaSync
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-emerald-50/70">
            Drug monitoring &amp; inventory for Klinik Kesihatan Kempas — control stock,
            drug requests, and antibiotic approvals in one place, precise and auditable.
          </p>

          <ul className="mt-8 space-y-3">
            {[
              { icon: ShieldCheck, text: "Quota management for special drugs" },
              { icon: Check, text: "Antibiotic approval per Clinical Pathway NAG 2024" },
              { icon: Lock, text: "Role-based access — officers, specialists, pharmacy" },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-sm text-emerald-50/85">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
                  <Icon className="h-3 w-3" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        {/* Footer spacer keeps the three-row justify-between rhythm */}
        <div className="relative z-10 h-1" />
      </aside>

      {/* ── Form panel ────────────────────────────────────────── */}
      <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-5 py-10 sm:px-8">
        {/* Interactive matrix — deep emerald on white, contrasting the left panel */}
        <PharmaMatrix variant="light" />
        <div className="relative z-10 w-full max-w-[400px] rounded-2xl border border-slate-200/70 bg-white/95 p-7 shadow-xl shadow-emerald-950/[0.06] backdrop-blur-sm sm:p-8">
          {/* Compact brand header (mobile only) */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-600">
              <Pill className="h-6 w-6 text-white" />
            </div>
            <div className="leading-tight">
              <p className="shimmer-emerald text-lg font-bold tracking-tight">PharmaSync</p>
              <p className="text-xs text-slate-500">Klinik Kesihatan Kempas</p>
            </div>
          </div>

          {forgotMode ? (
            /* ── Reset password ── */
            forgotSent ? (
              <div className="space-y-5 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                  <Check className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Link sent</h2>
                  <p className="mt-1.5 text-sm text-slate-500">
                    Check your email for a password reset link.
                  </p>
                </div>
                <Button
                  type="button"
                  className="w-full"
                  variant="outline"
                  onClick={() => { setForgotMode(false); setForgotSent(false); setForgotEmail(""); }}
                >
                  <ArrowLeft className="h-4 w-4" /> Back to sign in
                </Button>
              </div>
            ) : (
              <form onSubmit={handleForgotPassword} className="space-y-5">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight text-slate-900">Reset password</h2>
                  <p className="mt-1.5 text-sm text-slate-500">
                    Enter your email and we'll send you a reset link.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="forgot-email" className={labelClass}>Email</Label>
                  <Input
                    id="forgot-email"
                    type="email"
                    value={forgotEmail}
                    onChange={e => setForgotEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder="name@moh.gov.my"
                    className={inputClass}
                  />
                </div>
                {error && (
                  <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600" role="alert" aria-live="polite">
                    {error}
                  </p>
                )}
                <Button type="submit" className={primaryBtn} disabled={forgotLoading}>
                  {forgotLoading ? (<><Loader2 className="h-4 w-4 animate-spin" /> Sending…</>) : "Send reset link"}
                </Button>
                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-900"
                  onClick={() => { setForgotMode(false); setError(null); }}
                >
                  <ArrowLeft className="h-4 w-4" /> Back to sign in
                </button>
              </form>
            )
          ) : (
            /* ── Sign in / Sign up ── */
            <>
              <div className="mb-6">
                <h2 className="text-2xl font-bold tracking-tight text-slate-900">Welcome back</h2>
                <p className="mt-1.5 text-sm text-slate-500">Sign in to continue to the pharmacy system.</p>
              </div>

              <Tabs defaultValue="login" onValueChange={() => setError(null)}>
                <TabsList className="mb-6 grid w-full grid-cols-2 bg-slate-100">
                  <TabsTrigger value="login">Sign In</TabsTrigger>
                  <TabsTrigger value="signup">Sign Up</TabsTrigger>
                </TabsList>

                {/* Sign in */}
                <TabsContent value="login">
                  <form onSubmit={handleLogin} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="login-email" className={labelClass}>Email</Label>
                      <Input
                        id="login-email"
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        required
                        autoComplete="email"
                        placeholder="name@moh.gov.my"
                        className={inputClass}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="login-password" className={labelClass}>Password</Label>
                        <button
                          type="button"
                          className="text-xs font-medium text-emerald-600 transition-colors hover:text-emerald-700"
                          onClick={() => { setForgotMode(true); setError(null); }}
                        >
                          Forgot password?
                        </button>
                      </div>
                      <Input
                        id="login-password"
                        type="password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        required
                        autoComplete="current-password"
                        placeholder="••••••••"
                        className={inputClass}
                      />
                    </div>
                    {error && (
                      <p id="login-error" role="alert" aria-live="polite" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
                        {error}
                      </p>
                    )}
                    <Button
                      type="submit"
                      className={primaryBtn}
                      disabled={submitting}
                      aria-describedby={error ? "login-error" : undefined}
                    >
                      {submitting ? (<><Loader2 className="h-4 w-4 animate-spin" /> Signing in…</>) : "Sign In"}
                    </Button>

                    <div className="relative flex items-center gap-3 py-1">
                      <div className="h-px flex-1 bg-slate-200" />
                      <span className="text-xs font-medium uppercase tracking-wide text-slate-400">or</span>
                      <div className="h-px flex-1 bg-slate-200" />
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 w-full font-medium"
                      disabled={googleLoading || submitting}
                      onClick={handleGoogleLogin}
                    >
                      {googleLoading ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> Processing…</>
                      ) : (
                        <>
                          <svg className="h-4 w-4" viewBox="0 0 24 24">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                          </svg>
                          Continue with Google
                        </>
                      )}
                    </Button>
                  </form>
                </TabsContent>

                {/* Sign up */}
                <TabsContent value="signup">
                  <form onSubmit={handleSignup} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="signup-name" className={labelClass}>Full Name</Label>
                      <Input
                        id="signup-name"
                        type="text"
                        value={fullName}
                        onChange={e => setFullName(e.target.value)}
                        required
                        autoComplete="name"
                        placeholder="Your full name"
                        className={inputClass}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="signup-clinic" className={labelClass}>Clinic</Label>
                      <Select value={clinicId} onValueChange={setClinicId} required>
                        <SelectTrigger id="signup-clinic" className={inputClass}>
                          <SelectValue placeholder="Select your clinic" />
                        </SelectTrigger>
                        <SelectContent>
                          {clinics?.map(c => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="signup-email" className={labelClass}>Email</Label>
                      <Input
                        id="signup-email"
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        required
                        autoComplete="email"
                        placeholder="name@moh.gov.my"
                        className={inputClass}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="signup-password" className={labelClass}>Password</Label>
                      <Input
                        id="signup-password"
                        type="password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        required
                        minLength={6}
                        autoComplete="new-password"
                        placeholder="Minimum 6 characters"
                        className={inputClass}
                      />
                    </div>
                    {error && (
                      <p id="signup-error" role="alert" aria-live="polite" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
                        {error}
                      </p>
                    )}
                    <Button
                      type="submit"
                      className={primaryBtn}
                      disabled={submitting || !clinicId}
                      aria-describedby={error ? "signup-error" : undefined}
                    >
                      {submitting ? (<><Loader2 className="h-4 w-4 animate-spin" /> Creating account…</>) : "Create Account"}
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
