import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App.tsx";
import "./index.css";

const dsn = import.meta.env.VITE_SENTRY_DSN;
if (dsn) {
  Sentry.init({ dsn });
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
