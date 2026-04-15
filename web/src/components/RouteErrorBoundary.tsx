import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * React's <Suspense fallback> only catches suspensions, not render errors —
 * if a page component throws during render (mismatched JSON shape, a nullish
 * lookup, etc.) React silently unmounts the whole subtree and the `<main>`
 * outlet goes blank with no console hint for the user.
 *
 * This boundary turns that failure mode into a visible, actionable panel.
 * It's intentionally dumb — no translation, no retry button beyond a reload
 * — because the whole point is "at least show something" when the rest of
 * the render layer has gone sideways.
 */
interface RouteErrorBoundaryProps {
  children: ReactNode;
  /** Bump to reset the error — e.g. on route change. */
  resetKey?: string | number;
}

interface RouteErrorBoundaryState {
  error: Error | null;
}

export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the original stack in the devtools console — the visible card is
    // a summary, the full trace here is what you actually want when debugging.
    // eslint-disable-next-line no-console
    console.error("[RouteErrorBoundary]", error, info.componentStack);
  }

  componentDidUpdate(prev: RouteErrorBoundaryProps): void {
    if (
      this.state.error &&
      prev.resetKey !== this.props.resetKey
    ) {
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full items-start justify-center p-6">
        <div className="max-w-xl w-full rounded-[var(--radius-md)] border border-[hsl(var(--destructive)/0.5)] bg-[hsl(var(--destructive)/0.08)] p-5">
          <div className="text-[14px] font-semibold text-[hsl(var(--destructive))]">
            Page render failed
          </div>
          <div className="mt-1 text-[12px] text-[hsl(var(--muted-foreground))]">
            An unhandled error crashed this page. Switching tabs will reset it;
            the full stack is in the devtools console.
          </div>
          <pre className="mt-3 max-h-64 overflow-auto rounded-[var(--radius-sm)] bg-[hsl(var(--canvas))] p-3 text-[11px] font-mono text-[hsl(var(--foreground))]">
            {error.name}: {error.message}
            {error.stack ? `\n\n${error.stack}` : ""}
          </pre>
        </div>
      </div>
    );
  }
}

export default RouteErrorBoundary;
