import * as React from "react";

const MOBILE_BREAKPOINT = 768;

const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

export function useIsMobile() {
  // Initialised synchronously rather than from undefined: returning false on the
  // first paint gave phone users a frame of the desktop layout (the sidebar rail
  // flashing in before the Sheet took over). Safe here because the app is
  // client-rendered only — main.tsx renders straight into #root, no SSR pass.
  const [isMobile, setIsMobile] = React.useState(
    () => typeof window !== "undefined" && window.matchMedia(QUERY).matches
  );

  React.useEffect(() => {
    const mql = window.matchMedia(QUERY);
    // Reads mql.matches rather than window.innerWidth so this can never disagree
    // with the media query that drives the CSS breakpoints.
    const onChange = () => setIsMobile(mql.matches);
    mql.addEventListener("change", onChange);
    onChange();
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
