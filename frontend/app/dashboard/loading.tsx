import React from "react";

export default function DashboardLoading() {
  return (
    <div
      style={{
        minHeight: "80vh",
        padding: "1.5rem",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: "1.5rem",
      }}
    >
      {/* Top row stat cards skeleton */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "1.25rem",
        }}
      >
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            style={{
              height: "110px",
              borderRadius: "16px",
              background: "var(--card-bg, rgba(255,255,255,0.04))",
              border: "1px solid var(--border-color, rgba(255,255,255,0.08))",
              animation: "skeletonPulse 1.4s ease-in-out infinite",
            }}
          />
        ))}
      </div>
      {/* Content panel skeleton */}
      <div
        style={{
          height: "360px",
          borderRadius: "18px",
          background: "var(--card-bg, rgba(255,255,255,0.04))",
          border: "1px solid var(--border-color, rgba(255,255,255,0.08))",
          animation: "skeletonPulse 1.4s ease-in-out infinite",
        }}
      />
      <style>{`
        @keyframes skeletonPulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 0.95; }
        }
      `}</style>
    </div>
  );
}
