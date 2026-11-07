import React from "react";

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40 }}>
          <h2>界面出错了</h2>
          <pre style={{ whiteSpace: "pre-wrap" }}>{String(this.state.error.stack || this.state.error)}</pre>
          <button className="btn" onClick={() => this.setState({ error: null })}>重试</button>
        </div>
      );
    }
    return this.props.children;
  }
}
