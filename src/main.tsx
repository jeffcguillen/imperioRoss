import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { registerPwa } from './pwa';
import { TenantProvider } from './tenants/TenantProvider';
import './styles.css';
import './styles/gold-reference.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter><TenantProvider><App /></TenantProvider></BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);

registerPwa();
