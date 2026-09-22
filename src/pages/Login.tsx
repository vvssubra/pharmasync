import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, ArrowRight, Check, Eye, EyeOff, Loader2, Lock, Mail, Pill, ShieldCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import CircuitTrail from "@/components/ui/circuit-trail";
import { AnnouncementTicker } from "@/components/AnnouncementTicker";

export default function Login() {
  const { user, loading, authError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState("");
  const [clinicId, setClinicId] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Clinic picker for signup — clinics table is anon-readable so this loads
  // before the user is authenticated.
  //
  // Every clinic is listed, HQ included. This briefly excluded is_hq so nobody
  // could "request membership of Logistik PKDJB", which blocked the HQ
  // pharmacists themselves from signing up — they could not see their own
  // workplace — while protecting nothing: handle_new_user() writes clinic_id
  // NULL and parks this choice in pending_clinic_id
  // (20260724000000 section 3), so picking a clinic here is a REQUEST, not a
  // grant. Until an approver acts, clinic_id is NULL and every clinic-scoped
  // RLS policy evaluates false. Approving into an arbitrary clinic is
  // super_admin-only (a plain admin's approve_clinic_member call ignores
  // target_clinic and pins to their own clinic), and the logistic_pharmacist
  // role is super_admin-only to grant. A bogus HQ request is therefore exactly
  // as harmless as a bogus request for any other clinic.
  const { data: clinics } = useQuery({
    queryKey: ["clinics-signup"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinics")
        .select("id, name")
        .order("name");
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
      <div className="flex min-h-dvh items-center justify-center bg-[#041512]">
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
      options: {
        redirectTo: `${window.location.origin}/`,
        queryParams: { hd: "moh.gov.my" },
      },
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

  const fieldClass =
    "h-11 rounded-xl border-slate-200 bg-slate-50/70 pl-10 text-slate-900 placeholder:text-slate-400 " +
    "focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-teal-700/40 focus-visible:border-teal-700";
  const inputClass =
    "h-11 rounded-xl border-slate-200 bg-slate-50/70 text-slate-900 placeholder:text-slate-400 " +
    "focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-teal-700/40 focus-visible:border-teal-700";
  const labelClass = "font-mono text-xs font-semibold tracking-wide text-slate-700";
  const primaryBtn =
    "group h-11 w-full rounded-xl bg-teal-700 text-sm font-semibold text-white shadow-md shadow-teal-900/10 " +
    "hover:bg-teal-800 hover:shadow-lg hover:shadow-teal-900/20 " +
    "transition-[background-color,box-shadow,transform] duration-150 active:scale-[0.98] motion-reduce:active:scale-100";
  const secondaryBtn =
    "h-11 w-full rounded-xl border-slate-200 bg-white text-sm font-medium text-slate-700 shadow-sm " +
    "hover:border-slate-300 hover:bg-slate-50 " +
    "transition-[background-color,border-color,transform] duration-150 active:scale-[0.98] motion-reduce:active:scale-100";

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-[#041512] text-slate-100 antialiased">
      {/* ── Canvas: depth wash + circuit light trails ─────────── */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 0%, rgba(15,118,110,0.22) 0%, transparent 55%)," +
            "radial-gradient(circle at 85% 100%, rgba(52,211,153,0.10) 0%, transparent 45%)",
        }}
      />
      <CircuitTrail />
      {/* Vignette so the trails read as ambient, not competing with the card. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 60% at 50% 50%, transparent 0%, rgba(4,21,18,0.55) 100%)",
        }}
      />

      <main className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col justify-between px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {/* ── Top command bar: district identity ──────────────── */}
        <div className="login-rise flex flex-col justify-between gap-4 border-b border-emerald-400/10 pb-6 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-emerald-300/30 bg-[#072a23] text-emerald-300 shadow-[0_0_15px_rgba(52,211,153,0.18)]">
              <Pill className="h-6 w-6" />
            </div>
            <div className="leading-tight">
              {/* District identity, not a clinic's. Nobody is signed in yet, so
                  there is no clinic to name — and naming one tells staff at the
                  other 14 they are in the wrong place. */}
              <h2 className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-slate-100">
                Pejabat Kesihatan Johor Bahru
              </h2>
              <p className="mt-0.5 font-mono text-[11px] font-medium uppercase tracking-wider text-emerald-400">
                Clinical Drug Management System
              </p>
            </div>
          </div>
          <div className="inline-flex items-center gap-2 self-start rounded-full border border-emerald-300/25 bg-emerald-950/80 px-3 py-1 font-mono text-xs text-emerald-300 shadow-sm sm:self-auto">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            Digital Bin Card System
          </div>
        </div>

        {/* ── Central stage: hero + auth card ─────────────────── */}
        <div className="grid grid-cols-1 items-center gap-8 py-6 lg:grid-cols-12 lg:py-8">
          {/* Hero narrative */}
          <div className="space-y-6 lg:col-span-6">
            <div className="login-rise space-y-3" style={{ animationDelay: "100ms" }}>
              <h1 className="text-4xl font-extrabold tracking-tight text-white drop-shadow-sm sm:text-5xl lg:text-6xl">
                Pharma
                <span className="bg-gradient-to-r from-emerald-200 via-emerald-400 to-teal-200 bg-clip-text text-transparent">
                  Sync
                </span>
              </h1>
              <p className="max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg">
                Drug monitoring &amp; inventory for Johor Bahru district clinics — control
                stock, drug requests, and antibiotic approvals in one place, precise and
                auditable.
              </p>
            </div>

            {/* Capabilities */}
            <div
              className="login-rise hidden rounded-2xl border border-emerald-500/20 bg-[#06231d]/80 p-5 shadow-2xl backdrop-blur-md lg:block"
              style={{ animationDelay: "220ms" }}
            >
              <ul className="divide-y divide-emerald-400/10">
                {[
                  {
                    icon: ShieldCheck,
                    title: "Quota management for special drugs",
                    sub: "Annual patient kuota per controlled drug",
                  },
                  {
                    icon: Check,
                    title: "Antibiotic approval per Clinical Pathway NAG 2024",
                    sub: "Doctor → specialist endorsement before dispensing",
                  },
                  {
                    icon: Lock,
                    title: "Role-based access controls",
                    sub: "Pharmacist • Family Medicine Specialist (FMS) • Medical Officer",
                  },
                ].map(({ icon: Icon, title, sub }, i) => (
                  <li
                    key={title}
                    className="login-rise flex items-start gap-3.5 py-3.5 first:pt-0 last:pb-0"
                    style={{ animationDelay: `${320 + i * 80}ms` }}
                  >
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-emerald-300/30 bg-emerald-900/60 text-emerald-300">
                      <Icon className="h-4 w-4" strokeWidth={2.2} />
                    </span>
                    <div className="text-sm">
                      <span className="font-semibold text-slate-100">{title}</span>
                      <p className="mt-0.5 font-mono text-xs text-slate-400">{sub}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Auth card */}
          <div className="flex flex-col items-center lg:col-span-6 lg:items-end">
            <div
              className="login-rise relative z-10 w-full max-w-md rounded-3xl border border-slate-200/90 bg-white p-7 text-slate-900 shadow-[0_25px_60px_rgba(0,0,0,0.5),0_0_40px_rgba(15,118,110,0.18)] sm:p-9"
              style={{ animationDelay: "160ms" }}
            >
              {forgotMode ? (
                /* ── Reset password ── */
                forgotSent ? (
                  <div className="space-y-5 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-teal-50 text-teal-700">
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
                      variant="outline"
                      className={secondaryBtn}
                      onClick={() => { setForgotMode(false); setForgotSent(false); setForgotEmail(""); }}
                    >
                      <ArrowLeft className="h-4 w-4" /> Back to sign in
                    </Button>
                  </div>
                ) : (
                  <form onSubmit={handleForgotPassword} className="space-y-5">
                    <div>
                      <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">Reset password</h2>
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
                      <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600" role="alert" aria-live="polite">
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
                  <div className="mb-5">
                    <span className="mb-3 inline-flex items-center gap-1.5 rounded-md border border-teal-200/60 bg-teal-50 px-2.5 py-1 font-mono text-[11px] font-semibold text-teal-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-teal-600" />
                      MOH SECURE GATEWAY
                    </span>
                    <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">Welcome back</h2>
                    <p className="mt-1.5 text-sm text-slate-500">Sign in to continue to the pharmacy system.</p>
                  </div>

                  <Tabs defaultValue="login" onValueChange={() => setError(null)}>
                    <TabsList className="mb-5 grid h-auto w-full grid-cols-2 rounded-xl border border-slate-200 bg-slate-100/90 p-1">
                      <TabsTrigger value="login" className="rounded-lg py-2 text-xs font-semibold sm:text-sm">Sign In</TabsTrigger>
                      <TabsTrigger value="signup" className="rounded-lg py-2 text-xs font-semibold sm:text-sm">Sign Up</TabsTrigger>
                    </TabsList>

                    {/* Sign in */}
                    <TabsContent value="login">
                      <form onSubmit={handleLogin} className="space-y-4">
                        <div className="space-y-1.5">
                          <Label htmlFor="login-email" className={labelClass}>Official Email / KKM ID</Label>
                          <div className="relative">
                            <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input
                              id="login-email"
                              type="email"
                              value={email}
                              onChange={e => setEmail(e.target.value)}
                              required
                              autoComplete="email"
                              placeholder="name@moh.gov.my"
                              className={fieldClass}
                            />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <Label htmlFor="login-password" className={labelClass}>Password</Label>
                            <button
                              type="button"
                              className="text-xs font-semibold text-teal-700 transition-colors hover:text-teal-800"
                              onClick={() => { setForgotMode(true); setError(null); }}
                            >
                              Forgot password?
                            </button>
                          </div>
                          <div className="relative">
                            <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input
                              id="login-password"
                              type={showPassword ? "text" : "password"}
                              value={password}
                              onChange={e => setPassword(e.target.value)}
                              required
                              autoComplete="current-password"
                              placeholder="Enter password"
                              className={`${fieldClass} pr-10`}
                            />
                            <button
                              type="button"
                              aria-label={showPassword ? "Hide password" : "Show password"}
                              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-600"
                              onClick={() => setShowPassword(s => !s)}
                            >
                              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          </div>
                        </div>
                        {(error || authError) && (
                          <p id="login-error" role="alert" aria-live="polite" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                            {error || authError}
                          </p>
                        )}
                        <div className="pt-1">
                          <Button
                            type="submit"
                            className={primaryBtn}
                            disabled={submitting}
                            aria-describedby={(error || authError) ? "login-error" : undefined}
                          >
                            {submitting ? (
                              <><Loader2 className="h-4 w-4 animate-spin" /> Signing in…</>
                            ) : (
                              <>
                                Sign In
                                <ArrowRight className="h-4 w-4 text-emerald-200 transition-transform group-hover:translate-x-0.5 motion-reduce:group-hover:translate-x-0" strokeWidth={2.5} />
                              </>
                            )}
                          </Button>
                        </div>

                        <div className="relative flex items-center gap-3 py-1">
                          <div className="h-px flex-1 bg-slate-200" />
                          <span className="font-mono text-xs font-semibold uppercase tracking-wider text-slate-400">or</span>
                          <div className="h-px flex-1 bg-slate-200" />
                        </div>

                        <Button
                          type="button"
                          variant="outline"
                          className={secondaryBtn}
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
                          <p id="signup-error" role="alert" aria-live="polite" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
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
                        {!clinicId && (
                          <p className="text-center text-xs text-slate-500">Select your clinic to continue.</p>
                        )}
                      </form>
                    </TabsContent>
                  </Tabs>

                  {/* Compliance footer */}
                  <footer className="mt-6 border-t border-slate-100 pt-5 text-center">
                    <div className="mb-1 flex items-center justify-center gap-1.5 text-xs text-slate-400">
                      <ShieldCheck className="h-3.5 w-3.5 text-teal-600" />
                      <span className="font-mono font-medium text-slate-600">Restricted Government Health System</span>
                    </div>
                    <p className="mx-auto max-w-xs text-[11px] leading-normal text-slate-400">
                      Authorized Ministry of Health Malaysia personnel only. All access is logged for audit.
                    </p>
                  </footer>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Bottom tray: live-fed district bulletins ────────────
            Admin-authored at /settings; renders nothing when there are no
            active rows, so an empty feed leaves no placeholder strip. */}
        <div className="login-rise mt-2 border-t border-emerald-400/10 pt-5 empty:hidden" style={{ animationDelay: "420ms" }}>
          <AnnouncementTicker />
        </div>

        {/* ── Footer ───────────────────────────────────────────── */}
        <footer className="mt-6 flex flex-col gap-3 border-t border-emerald-400/10 pt-5 font-mono text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span>© {new Date().getFullYear()} PKD Johor Bahru</span>
            <span>•</span>
            <span className="text-slate-300">Cawangan Farmasi &amp; Bekalan</span>
          </div>
          <span className="text-[11px] text-slate-500">Digital Bin Card System</span>
        </footer>
      </main>
    </div>
  );
}
