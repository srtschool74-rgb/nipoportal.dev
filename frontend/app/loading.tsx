import React from "react";

export default function RootLoading() {
  return (
    <div
      style={{
        minHeight: "100dvh",
        backgroundColor: "#060a28",
        padding: "1.5rem",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: "1.25rem",
      }}
    >
      {/* Topbar Skeleton */}
      <div
        style={{
          height: "60px",
          borderRadius: "14px",
          background: "linear-gradient(90deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 100%)",
          backgroundSize: "200% 100%",
          animation: "skeletonShimmer 1.5s infinite",
        }}
      />
      {/* Dashboard Grid Skeleton */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: "1.25rem",
        }}
      >
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            style={{
              height: "120px",
              borderRadius: "16px",
              background: "linear-gradient(90deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.02) 100%)",
              backgroundSize: "200% 100%",
              animation: "skeletonShimmer 1.5s infinite",
            }}
          />
        ))}
      </div>
      <style>{`
        @keyframes skeletonShimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}
