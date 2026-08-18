import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App.tsx";
import "./index.css";

// The DSN is public (it only permits submitting events, not reading them), so
// it is safe to bake into the bundle. VITE_SENTRY_DSN overrides it in any
// environment — set it to "" to turn Sentry off. Dev builds stay silent unless
// a DSN is passed explicitly, so local errors never reach the shared project.
const DEFAULT_DSN =
  "https://156e893abc3c62c785727bc05940f6b7@o4511462606176256.ingest.de.sentry.io/4511849863839824";
const dsn =
  import.meta.env.VITE_SENTRY_DSN ??
  (import.meta.env.PROD ? DEFAULT_DSN : undefined);

if (dsn) {
  Sentry.init({
    dsn,
    // PharmaSync handles patient records (names, IC numbers, drug histories),
    // so every category that could carry them is turned off explicitly rather
    // than left to the SDK defaults. Passing `dataCollection` at all switches
    // the SDK off its conservative legacy baseline and onto the permissive
    // DEFAULTS (userInfo/cookies/bodies/DB data all on), so each field below
    // has to be named — omitting one opts it in. Being explicit also survives
    // v11, where the deprecated `sendDefaultPii` baseline disappears.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: false, response: false },
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
    },
  });
}

createRoot(document.getElementById("root")!).render(
  <Sentry.ErrorBoundary
    fallback={
      <div className="flex min-h-screen items-center justify-center p-6 text-center">
        <div>
          <p className="text-lg font-medium">Something went wrong.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            The error has been reported. Please refresh the page.
          </p>
        </div>
      </div>
    }
  >
    <App />
  </Sentry.ErrorBoundary>,
);
