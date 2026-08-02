// src/pages/ChangePassword.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

/**
 * In-app password change for a signed-in user. Distinct from ResetPassword,
 * which is the landing page for an emailed recovery/invite link and has no
 * session to check the old password against.
 */
export default function ChangePassword() {
  const navigate = useNavigate();
  const { user, mustChangePassword } = useAuth();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password === current) {
      setError("New password must be different from the current one.");
      return;
    }
    setSubmitting(true);

    // GoTrue's secure_password_change is off on this deployment, so
    // updateUser() alone would let anyone who finds an open session replace the
    // password. Re-authenticating proves the current password is known.
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email: user?.email ?? "",
      password: current,
    });
    if (reauthError) {
      setError("Current password is incorrect.");
      setSubmitting(false);
      return;
    }

    // One call, so the flag can only clear alongside a real password change.
    const { error: updateError } = await supabase.auth.updateUser({
      password,
      data: { must_change_password: false },
    });
    if (updateError) {
      setError(updateError.message);
    } else {
      toast.success("Password updated.");
      navigate("/", { replace: true });
    }
    setSubmitting(false);
  };

  return (
    <div className="flex justify-center px-4 py-8">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Change Password</CardTitle>
          <CardDescription>
            {mustChangePassword
              ? "Your password was set by an administrator. Set your own password before continuing."
              : "Choose a new password for your account."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* noValidate: the mismatch / length / same-as-current messages below
              are the real validation; HTML5 bubbles would pre-empt them. */}
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="current-password">Current Password</Label>
              <Input
                id="current-password"
                type="password"
                value={current}
                onChange={e => setCurrent(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm New Password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Updating…" : "Update Password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
