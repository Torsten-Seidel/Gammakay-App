import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { installDevHooks } from './devHooks';

if (import.meta.env.DEV) installDevHooks();

/** Zeigt Renderfehler an, statt die Oberfläche komplett leer zu lassen. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="welcome">
        <h1>Unerwarteter Fehler</h1>
        <pre className="error-text" style={{ whiteSpace: 'pre-wrap', textAlign: 'left' }}>
          {this.state.error.message}
        </pre>
        <button className="btn primary" onClick={() => location.reload()}>Neu laden</button>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
