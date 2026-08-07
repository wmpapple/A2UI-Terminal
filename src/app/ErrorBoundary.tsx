import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Result } from 'antd';

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Application error', {
      name: error.name,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <Result
          status="error"
          title="A2UI Terminal could not render"
          extra={<Button onClick={() => window.location.reload()}>Reload</Button>}
        />
      );
    }
    return this.props.children;
  }
}
