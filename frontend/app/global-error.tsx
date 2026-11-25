"use client";

import React, { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const errorCode = error.digest || "ERR-GLOBAL";

  useEffect(() => {
    console.error(`[GlobalError][${errorCode}]`, error);
  }, [error, errorCode]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#090d16",
          color: "#f8fafc",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <div
          style={{
            maxWidth: "480px",
            padding: "2rem",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <div
            style={{
              width: "60px",
              height: "60px",
              borderRadius: "50%",
              backgroundColor: "rgba(239, 68, 68, 0.15)",
              color: "#ef4444",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: "1.25rem",
            }}
          >
            <AlertTriangle size={30} />
          </div>

          <h1 style={{ fontSize: "1.5rem", fontWeight: 800, margin: "0 0 0.5rem 0" }}>
            Application Error
          </h1>

          <p style={{ fontSize: "0.85rem", color: "#ef4444", fontWeight: 700, margin: "0 0 1rem 0" }}>
            Code: {errorCode}
          </p>

          <p style={{ fontSize: "0.9rem", color: "#94a3b8", lineHeight: 1.5, margin: "0 0 1.5rem 0" }}>
            A critical system error occurred. Please try reloading the page.
          </p>

          <button
            type="button"
            onClick={() => reset()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.65rem 1.4rem",
              backgroundColor: "#3b82f6",
              color: "#ffffff",
              fontWeight: 700,
              borderRadius: "8px",
              border: "none",
              cursor: "pointer",
              fontSize: "0.9rem",
            }}
          >
            <RotateCcw size={16} />
            Reload Portal
          </button>
        </div>
      </body>
    </html>
  );
}
