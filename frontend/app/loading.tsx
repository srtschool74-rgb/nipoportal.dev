import React from "react";
import SrtLogo from "@/frontend/components/ui/SrtLogo";

export default function RootLoading() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100dvh",
        padding: "1.5rem",
        boxSizing: "border-box",
        backgroundColor: "#060a28",
        color: "#ffffff",
        gap: "1.5rem",
      }}
    >
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: "72px",
            height: "72px",
            borderRadius: "50%",
            border: "3px solid rgba(242, 184, 75, 0.2)",
            borderTopColor: "#f2b84b",
            animation: "rootSpin 0.9s cubic-bezier(0.5, 0.1, 0.5, 0.9) infinite",
          }}
        />
        <SrtLogo size={42} priority />
      </div>
      <div style={{ textAlign: "center" }}>
        <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#f8fafc", margin: "0 0 0.35rem 0", letterSpacing: "0.02em" }}>
          SRT Universal School
        </h3>
        <p style={{ fontSize: "0.85rem", color: "rgba(242, 184, 75, 0.85)", margin: 0, fontWeight: 500 }}>
          Loading your dashboard...
        </p>
      </div>
      <style>{`
        @keyframes rootSpin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
