"use client";

// Last-resort boundary for errors in the root layout. It replaces the whole
// document, so it uses inline styles rather than the app stylesheet.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : null;
  return (
    <html lang="en-KE">
      <body style={{ margin: 0, background: "#f3efe6", color: "#282821", fontFamily: "Georgia, serif" }}>
        <title>Something went wrong · Merven Fashions</title>
        <main style={{ maxWidth: 480, margin: "0 auto", padding: "96px 16px", textAlign: "center" }}>
          <h1 style={{ fontWeight: 500, fontSize: 32 }}>Something went wrong.</h1>
          <p style={{ fontFamily: "system-ui, sans-serif" }}>Please try again in a moment.</p>
          <button
            type="button"
            onClick={() => retry()}
            style={{ marginTop: 24, minHeight: 44, padding: "0 24px", background: "#183c30", color: "#fff", border: 0, cursor: "pointer" }}
          >
            Try again
          </button>
          {digest && <p style={{ marginTop: 40, fontSize: 12, color: "#66625a", fontFamily: "system-ui, sans-serif" }}>Reference: {digest}</p>}
        </main>
      </body>
    </html>
  );
}
