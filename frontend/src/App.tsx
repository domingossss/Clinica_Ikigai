import { lazy, Suspense, useEffect } from 'react';
import { startClinicUpdates } from './services/clinicUpdates';

const Agendamentos = lazy(() => import('./components/DashboardDemo'));
const Dashboard = lazy(() => import('./indicadores/main'));

function App() {
  useEffect(() => startClinicUpdates(), []);
  const route = window.location.pathname.replace(/\/+$/, '') || '/';

  useEffect(() => {
    if (route === '/') {
      window.history.replaceState(window.history.state, '', '/agendamentos' + window.location.search + window.location.hash);
    }
    document.title = route === '/dashboard'
      ? 'Dashboard | Clínica Ikigai'
      : route === '/' || route === '/agendamentos'
        ? 'Agendamentos | Clínica Ikigai'
        : 'Página não encontrada | Clínica Ikigai';
  }, [route]);

  if (route !== '/' && route !== '/agendamentos' && route !== '/dashboard') {
    return <main className="max-w-7xl mx-auto p-8"><h1>Página não encontrada</h1></main>;
  }

  return (
    <Suspense fallback={<p role="status">Carregando página...</p>}>
      {route === '/dashboard' ? <Dashboard /> : <Agendamentos />}
    </Suspense>
  );
}

export default App;
