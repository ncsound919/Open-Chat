import React from "react";

/**
 * React Error Boundary — catches unhandled render errors and shows a
 * graceful fallback instead of a blank/broken screen.
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: "", resetKey: 0 };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      // Avoid leaking stack traces or credentials in the UI
      errorMessage: error?.message ?? "An unexpected error occurred.",
    };
  }

  componentDidCatch(error, info) {
    // Log to console without exposing tokens / sensitive data
    console.error("[OpenChat] Unhandled render error:", error?.message ?? error);
    console.error("[OpenChat] Component stack:", info?.componentStack ?? "");
  }

  handleReset = () => {
    // Increment resetKey to force a full remount of children,
    // clearing any state that caused the error.
    this.setState((prev) => ({
      hasError: false,
      errorMessage: "",
      resetKey: prev.resetKey + 1,
    }));
  };

  render() {
    if (!this.state.hasError) {
      return (
        <React.Fragment key={this.state.resetKey}>
          {this.props.children}
        </React.Fragment>
      );
    }

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100dvh",
          background: "#0d0d14",
          color: "#e8e8f0",
          fontFamily: "system-ui, sans-serif",
          padding: 24,
          gap: 16,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 36 }}>⚠️</div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Something went wrong</div>
        <div style={{ fontSize: 13, color: "#666680", maxWidth: 360, lineHeight: 1.6 }}>
          {this.state.errorMessage}
        </div>
        <button
          onClick={this.handleReset}
          style={{
            marginTop: 8,
            background: "#818cf8",
            color: "#0d0d14",
            border: "none",
            borderRadius: 10,
            padding: "10px 24px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </div>
    );
  }
}
