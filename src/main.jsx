import { createRoot } from 'react-dom/client'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import App from './App'
import './index.css'

const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30000, gcTime: 864e5 } } })
const persister = createSyncStoragePersister({ storage: window.localStorage })
createRoot(document.getElementById('root')).render(
  <PersistQueryClientProvider client={client} persistOptions={{ persister, maxAge: 864e5 }}><App /></PersistQueryClientProvider>)
if (import.meta.env.PROD && 'serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js'))
