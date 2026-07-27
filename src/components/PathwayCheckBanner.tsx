import { Loader2, CheckCircle2, AlertTriangle, XCircle, MessageSquare, WifiOff } from "lucide-react";
import type { PathwayVerdict, PathwayStatus } from "@/hooks/usePathwayCheck";

interface Props {
  status: PathwayStatus;
  verdict: PathwayVerdict;
  explanation: string;
}

const VERDICT_CONFIG = {
  supported: {
    icon: CheckCircle2,
    bg: "bg-green-50 border-green-300 text-green-800",
    label: "Supported by NAG",
  },
  review: {
    icon: AlertTriangle,
    bg: "bg-amber-50 border-amber-300 text-amber-800",
    label: "Review Recommended",
  },
  not_supported: {
    icon: XCircle,
    bg: "bg-red-50 border-red-300 text-red-800",
    label: "Not Supported by NAG",
  },
  refer_specialist: {
    icon: MessageSquare,
    bg: "bg-blue-50 border-blue-300 text-blue-800",
    label: "Refer to Specialist",
  },
};

export default function PathwayCheckBanner({ status, verdict, explanation }: Props) {
  if (status === "idle") return null;

  if (status === "checking") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking NAG pathway...
      </div>
    );
  }

  if (status === "unavailable" || status === "error") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
        <WifiOff className="h-4 w-4" />
        Pathway check temporarily unavailable. You can still submit.
      </div>
    );
  }

  if (!verdict) return null;

  const config = VERDICT_CONFIG[verdict];
  const Icon = config.icon;

  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${config.bg}`}>
      <Icon className="h-4 w-4 mt-0.5 shrink-0" />
      <div>
        <span className="font-medium">{config.label}</span>
        {explanation && <p className="text-xs mt-0.5 opacity-90">{explanation}</p>}
        <p className="text-xs mt-0.5 opacity-70">
          Rule-based check against NAG 2024. Not a substitute for clinical judgement.
        </p>
      </div>
    </div>
  );
}
