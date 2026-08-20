import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import SecurityLogs from "./pages/SecurityLogs";
import QueryPlayground from "./pages/QueryPlayground";
import PerformanceAnalytics from "./pages/PerformanceAnalytics";
import PolicyManagement from "./pages/PolicyManagement";

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/" element={<Overview />} />
              <Route path="/logs" element={<SecurityLogs />} />
              <Route path="/playground" element={<QueryPlayground />} />
              <Route path="/performance" element={<PerformanceAnalytics />} />
              <Route path="/policies" element={<PolicyManagement />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
