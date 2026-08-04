import * as React from "react";
import { motion, AnimatePresence, useMotionValue, useTransform, useSpring, useReducedMotion } from "motion/react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

export interface StatBreakdownItem {
  label: string;
  value: number;
}

export interface ExpandableStatCardProps {
  icon: LucideIcon;
  count: number;
  label: string;
  /** Card background, e.g. "bg-yellow-50 dark:bg-yellow-900/30". */
  bgClassName?: string;
  /** Icon + count color, e.g. "text-yellow-700 dark:text-yellow-400". */
  colorClassName?: string;
  /** Revealed on hover as a small breakdown list. Omit for cards with no natural sub-split. */
  breakdown?: StatBreakdownItem[];
  onClick?: () => void;
  /** Ring highlight, mirrors the existing stockFilter "active" convention on these dashboards. */
  active?: boolean;
  className?: string;
}

// Adapted from a supplied LocationMap demo (3D mouse-tilt + click-to-expand
// map card). The map/road SVG art doesn't apply here, so expansion instead
// reveals a count breakdown, and it triggers on hover rather than click —
// click stays wired to the caller's existing filter/scroll behavior.
export const ExpandableStatCard = React.forwardRef<HTMLDivElement, ExpandableStatCardProps>(
  ({ icon: Icon, count, label, bgClassName, colorClassName, breakdown, onClick, active, className }, ref) => {
    const [isHovered, setIsHovered] = React.useState(false);
    const innerRef = React.useRef<HTMLDivElement>(null);
    const prefersReducedMotion = useReducedMotion();

    const mouseX = useMotionValue(0);
    const mouseY = useMotionValue(0);
    const rotateX = useTransform(mouseY, [-50, 50], [8, -8]);
    const rotateY = useTransform(mouseX, [-50, 50], [-8, 8]);
    const springRotateX = useSpring(rotateX, { stiffness: 300, damping: 30 });
    const springRotateY = useSpring(rotateY, { stiffness: 300, damping: 30 });

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
      if (prefersReducedMotion || !innerRef.current) return;
      const rect = innerRef.current.getBoundingClientRect();
      mouseX.set(e.clientX - (rect.left + rect.width / 2));
      mouseY.set(e.clientY - (rect.top + rect.height / 2));
    };

    const handleMouseLeave = () => {
      mouseX.set(0);
      mouseY.set(0);
      setIsHovered(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!onClick) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick();
      }
    };

    const showBreakdown = isHovered && !!breakdown && breakdown.length > 0;

    return (
      <Card
        ref={(node) => {
          innerRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        noGlow
        data-testid={`stat-card-${label}`}
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        onClick={onClick}
        onKeyDown={handleKeyDown}
        onMouseMove={handleMouseMove}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={handleMouseLeave}
        onFocus={() => setIsHovered(true)}
        onBlur={handleMouseLeave}
        style={{ perspective: 1000 }}
        className={cn(bgClassName, onClick && "cursor-pointer", active && "ring-2 ring-primary", className)}
      >
        <motion.div
          style={{
            rotateX: prefersReducedMotion ? 0 : springRotateX,
            rotateY: prefersReducedMotion ? 0 : springRotateY,
            transformStyle: "preserve-3d",
          }}
          className="p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Icon className={cn("h-6 w-6", colorClassName)} />
              <div>
                <p className={cn("text-2xl font-bold", colorClassName ?? "text-foreground")}>{count}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-foreground/5 shrink-0">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              <span className="text-[10px] font-medium text-muted-foreground tracking-wide uppercase">Live</span>
            </div>
          </div>

          <AnimatePresence>
            {showBreakdown && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: prefersReducedMotion ? 0 : 0.25 }}
                className="mt-3 space-y-1 overflow-hidden border-t pt-2"
              >
                {breakdown!.map((item) => (
                  <div key={item.label} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className="font-medium">{item.value}</span>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <motion.div
            className="h-px mt-3 bg-gradient-to-r from-emerald-500/50 via-emerald-400/30 to-transparent"
            initial={false}
            animate={{ scaleX: isHovered ? 1 : 0.3 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.4, ease: "easeOut" }}
            style={{ originX: 0 }}
          />
        </motion.div>
      </Card>
    );
  }
);
ExpandableStatCard.displayName = "ExpandableStatCard";
