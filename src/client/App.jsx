import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import BusyOverlay from './BusyOverlay';
import { AuthProvider, ThemeProvider, TimerProvider, ToastProvider, useAuth } from './context';
import Layout from './Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import MyTime from './pages/MyTime';
import Approvals from './pages/Approvals';
import Reports from './pages/Reports';
import People from './pages/People';
import Audit from './pages/Audit';
import Settings from './pages/Settings';
import { PageSkeleton } from './ui';

function Gate({ need, children }) {
  const { can } = useAuth();
  return !need || can[need] ? children : <Navigate to="/" replace />;
}

function Routed() {
  const { user, ready } = useAuth();
  if (!ready) return <div style={{ padding: 40 }}><PageSkeleton /></div>;
  if (!user) return <Login />;
  return (
    <TimerProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="projects" element={<Projects />} />
          <Route path="projects/:id" element={<ProjectDetail />} />
          <Route path="time" element={<Gate need="track"><MyTime /></Gate>} />
          <Route path="approvals" element={<Gate need="review"><Approvals /></Gate>} />
          <Route path="reports" element={<Reports />} />
          <Route path="people" element={<Gate need="owner"><People /></Gate>} />
          <Route path="audit" element={<Gate need="owner"><Audit /></Gate>} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </TimerProvider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routed />
          </BrowserRouter>
          <BusyOverlay />
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
