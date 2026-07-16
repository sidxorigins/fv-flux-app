/**
 * Auth route group shell — login, register, and set-password all render
 * inside this. No app shell/sidebar here: full-height, centered, single
 * glass card floating on the shared body gradient backdrop (see
 * globals.css `body` background-image).
 */
export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-12">
      {/* Wordmark — typographic only, no image (matches Sidebar.tsx). */}
      <div className="flex items-center gap-2">
        <span className="text-2xl font-bold tracking-tight text-foreground">
          Flux
          <span aria-hidden className="text-primary">
            .
          </span>
        </span>
      </div>

      <div className="glass w-full max-w-md p-6 sm:p-8">{children}</div>
    </div>
  );
}
