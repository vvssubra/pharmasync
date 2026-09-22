import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getErrorMessage } from "@/lib/errors";
import { Megaphone, Plus, Pencil, Trash2, Radio } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Announcement = {
  id: string;
  message: string;
  is_active: boolean;
  created_at: string;
};

/**
 * Announcements — admin-authored notices fed into the login page ticker.
 * Gated to admin + super_admin (ProtectedRoute's ROUTE_PERMISSIONS).
 *
 * Deployment-wide, not clinic-scoped: the login page renders before any
 * clinic is known, so there's nothing to scope by. Every admin on the
 * deployment writes the same feed.
 */
export default function Settings() {
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Announcement | null>(null);
  const [message, setMessage] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null);

  const { data: announcements = [], isLoading } = useQuery<Announcement[]>({
    queryKey: ["announcements-admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("announcements")
        .select("id, message, is_active, created_at")
        .order("is_active", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const activeCount = announcements.filter((a) => a.is_active).length;

  function openCreate() {
    setEditTarget(null);
    setMessage("");
    setIsActive(true);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(a: Announcement) {
    setEditTarget(a);
    setMessage(a.message);
    setIsActive(a.is_active);
    setFormError(null);
    setFormOpen(true);
  }

  const saveAnnouncement = useMutation({
    mutationFn: async () => {
      const trimmed = message.trim();
      if (!trimmed) throw new Error("Announcement text can't be empty.");
      if (editTarget) {
        const { error } = await supabase
          .from("announcements")
          .update({ message: trimmed, is_active: isActive })
          .eq("id", editTarget.id);
        if (error) throw error;
      } else {
        // created_by is stamped server-side by trg_announcements_created_by —
        // nothing to send here.
        const { error } = await supabase
          .from("announcements")
          .insert({ message: trimmed, is_active: isActive });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["announcements-admin"] });
      queryClient.invalidateQueries({ queryKey: ["announcements-ticker"] });
      toast.success(editTarget ? "Announcement updated." : "Announcement created.");
      setFormOpen(false);
    },
    onError: (err: unknown) => setFormError(getErrorMessage(err, "Failed to save announcement.")),
  });

  const toggleActive = useMutation({
    mutationFn: async (a: Announcement) => {
      const { error } = await supabase
        .from("announcements")
        .update({ is_active: !a.is_active })
        .eq("id", a.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["announcements-admin"] });
      queryClient.invalidateQueries({ queryKey: ["announcements-ticker"] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err, "Failed to update announcement.")),
  });

  const deleteAnnouncement = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("announcements").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["announcements-admin"] });
      queryClient.invalidateQueries({ queryKey: ["announcements-ticker"] });
      toast.success("Announcement deleted.");
      setDeleteTarget(null);
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to delete announcement."));
      setDeleteTarget(null);
    },
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-6 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
            <Radio className="h-3 w-3" />
            Login Ticker Feed
          </span>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Megaphone className="h-5 w-5" />
            </span>
            Settings
          </h1>
          <p className="text-sm text-muted-foreground">
            Announcements shown in the scrolling ticker on the login page, for every user on this deployment.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-1 h-4 w-4" /> New Announcement
        </Button>
      </div>

      <Card>
        <CardHeader className="border-b bg-muted/30 py-4">
          <CardTitle className="text-base flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Megaphone className="h-4 w-4" />
            </span>
            Announcements
            <span className="ml-1 text-sm font-normal text-muted-foreground">
              — {activeCount} live on the ticker
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Message</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-6">
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ) : announcements.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4}>
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <Megaphone className="mb-2 h-8 w-8" />
                      <p className="text-sm">No announcements yet. Click 'New Announcement' to start.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                announcements.map((a) => (
                  <TableRow key={a.id} className={cn(!a.is_active && "opacity-60")}>
                    <TableCell className="max-w-md">
                      <p className="truncate text-sm">{a.message}</p>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          a.is_active
                            ? "border-emerald-300 bg-emerald-100/70 text-emerald-700"
                            : "text-muted-foreground"
                        }
                      >
                        {a.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(a.created_at).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Switch
                          checked={a.is_active}
                          onCheckedChange={() => toggleActive.mutate(a)}
                          aria-label={a.is_active ? "Deactivate announcement" : "Activate announcement"}
                        />
                        <Button variant="ghost" size="sm" className="min-h-[44px]" onClick={() => openEdit(a)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="min-h-[44px] text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(a)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create / edit */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editTarget ? "Edit Announcement" : "New Announcement"}</DialogTitle>
            <DialogDescription>
              Shown to everyone on the login page ticker while active — signed in or not.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="announcement-message">Message</Label>
              <Textarea
                id="announcement-message"
                value={message}
                onChange={(e) => { setMessage(e.target.value); setFormError(null); }}
                placeholder="e.g. System maintenance on 30 Sept, 10pm–midnight."
                rows={3}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="announcement-active" className="text-sm font-medium">
                Show on ticker now
              </Label>
              <Switch id="announcement-active" checked={isActive} onCheckedChange={setIsActive} />
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button
              onClick={() => saveAnnouncement.mutate()}
              disabled={!message.trim() || saveAnnouncement.isPending}
            >
              {saveAnnouncement.isPending ? "Saving..." : editTarget ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete announcement?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes it from the login ticker immediately. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteAnnouncement.mutate(deleteTarget.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
