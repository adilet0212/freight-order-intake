import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createApi } from './api/client.js';
import { App } from './App.js';
import { connectLive } from './live/connection.js';
import { OrderStore } from './orders/order-store.js';
import { ServicesContext, type Services } from './services.js';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');

const api = createApi();
const live = connectLive();
const store = new OrderStore(api, live);
const services: Services = { api, live, store };
store.start();

createRoot(root).render(
  <StrictMode>
    <ServicesContext value={services}>
      <App />
    </ServicesContext>
  </StrictMode>,
);
