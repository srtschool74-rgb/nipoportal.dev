"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw, Home, Copy, Check, ChevronDown, ChevronUp } from "lucide-react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  // Generate or use deterministic short error ID
  const errorCode = error.digest || `ERR-${Math.abs(
    (error.message || "UNKNOWN").split("").reduce((acc, char) => (acc << 5) - acc + char.charCodeAt(0), 0)
  ).toString(36).toUpperCase().slice(0, 6)}`;

  useEffect(() => {
    console.error(`[DashboardError][${errorCode}]`, error);
  }, [error, errorCode]);

  const handleCopy = () => {
    const errorDetails = `Error Code: ${errorCode}\nMessage: ${error.message || "Unknown error"}\nDigest: ${error.digest || "N/A"}\nTime: ${new Date().toISOString()}`;
    navigator.clipboard.writeText(errorDetails).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }).catch(() => {});
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "65vh",
        padding: "2rem 1.5rem",
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: "64px",
          height: "64px",
          borderRadius: "50%",
          backgroundColor: "rgba(239, 68, 68, 0.12)",
          color: "#ef4444",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "1.25rem",
        }}
      >
        <AlertTriangle size={32} />
      </div>

      <h2
        style={{
          fontSize: "1.5rem",
          fontWeight: 800,
          color: "var(--foreground, #f8fafc)",
          margin: "0 0 0.5rem 0",
          letterSpacing: "-0.02em",
        }}
      >
        Something went wrong
      </h2>

      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.3rem 0.75rem",
          backgroundColor: "rgba(239, 68, 68, 0.08)",
          borderRadius: "9999px",
          border: "1px solid rgba(239, 68, 68, 0.2)",
          fontSize: "0.8rem",
          fontWeight: 700,
          color: "#ef4444",
          marginBottom: "1rem",
        }}
      >
        <span>Error Code: {errorCode}</span>
      </div>

      <p
        style={{
          fontSize: "0.95rem",
          color: "var(--text-secondary, #94a3b8)",
          maxWidth: "480px",
          lineHeight: 1.5,
          margin: "0 0 1.75rem 0",
        }}
      >
        An unexpected issue occurred while rendering this dashboard section. You can reload the page or return to your main dashboard.
      </p>

      {/* Primary Actions */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          flexWrap: "wrap",
          justifyContent: "center",
          marginBottom: "1.5rem",
        }}
      >
        <button
          type="button"
          onClick={() => reset()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.65rem 1.35rem",
            backgroundColor: "#3b82f6",
            color: "#ffffff",
            fontWeight: 700,
            borderRadius: "10px",
            border: "none",
            cursor: "pointer",
            fontSize: "0.85rem",
            boxShadow: "0 2px 8px rgba(59, 130, 246, 0.3)",
          }}
        >
          <RotateCcw size={16} />
          Reload
        </button>

        <Link
          href="/dashboard"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.65rem 1.35rem",
            backgroundColor: "var(--card-bg, #1e293b)",
            color: "var(--foreground, #f8fafc)",
            fontWeight: 600,
            borderRadius: "10px",
            border: "1px solid var(--border-color, #334155)",
            textDecoration: "none",
            fontSize: "0.85rem",
          }}
        >
          <Home size={16} />
          Dashboard
        </Link>

        <button
          type="button"
          onClick={handleCopy}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.45rem",
            padding: "0.65rem 1.15rem",
            backgroundColor: copied ? "rgba(16, 185, 129, 0.15)" : "transparent",
            color: copied ? "#10b981" : "var(--text-muted, #94a3b8)",
            fontWeight: 600,
            borderRadius: "10px",
            border: "1px solid var(--border-color, #334155)",
            cursor: "pointer",
            fontSize: "0.85rem",
            transition: "all 0.15s ease",
          }}
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? "Copied" : "Copy error code"}
        </button>
      </div>

      {/* Admin Technical Diagnostic Details Dropdown */}
      <div style={{ width: "100%", maxWidth: "600px", marginTop: "0.5rem" }}>
        <button
          type="button"
          onClick={() => setShowDetails(!showDetails)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.4rem",
            background: "none",
            border: "none",
            color: "var(--text-muted, #64748b)",
            fontSize: "0.785rem",
            fontWeight: 600,
            cursor: "pointer",
            padding: "0.25rem 0.5rem",
          }}
        >
          {showDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {showDetails ? "Hide technical diagnostic details" : "Show technical diagnostic details"}
        </button>

        {showDetails && (
          <div
            style={{
              marginTop: "0.75rem",
              padding: "1rem",
              borderRadius: "10px",
              backgroundColor: "rgba(15, 23, 42, 0.6)",
              border: "1px solid var(--border-color, #334155)",
              textAlign: "left",
              fontFamily: "monospace",
              fontSize: "0.75rem",
              color: "#f87171",
              maxHeight: "220px",
              overflowY: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            <div><strong>Error:</strong> {error.message || "Unknown error occurred"}</div>
            {error.digest && <div><strong>Digest:</strong> {error.digest}</div>}
            {error.stack && (
              <div style={{ marginTop: "0.5rem", color: "#94a3b8", fontSize: "0.7rem" }}>
                {error.stack}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
