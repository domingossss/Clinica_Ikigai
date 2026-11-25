import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch() {
    // Evita derrubar toda a árvore React para tela branca sem opção de recuperação.
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="min-h-screen bg-light-gray flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-gray/15 p-6 text-center space-y-4">
            <h1 className="text-lg font-bold text-dark">Algo deu errado ao exibir esta tela</h1>
            <p className="text-xs text-gray">
              Ocorreu um erro inesperado na interface. Recarregue a página para continuar usando o sistema.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-xl bg-primary text-white text-xs font-bold hover:bg-primary-dark transition-all cursor-pointer"
            >
              Recarregar página
            </button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
