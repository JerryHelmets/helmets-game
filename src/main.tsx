// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { Analytics } from "@vercel/analytics/react";

const root = ReactDOM.createRoot(
  document.getElementById("root")!
);

root.render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      
      {/* Vercel Web Analytics */}
      
      <Analytics />
    </BrowserRouter>
  </React.StrictMode>
);
