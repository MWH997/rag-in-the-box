import { createBrowserRouter, Navigate } from "react-router";
import { Login } from "./routes/Login.js";
import { App } from "./routes/App.js";

export const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/login" replace /> },
  { path: "/login", element: <Login /> },
  { path: "/app", element: <App /> },
]);
