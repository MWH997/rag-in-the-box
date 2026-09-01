import { Suspense, lazy, type ReactNode } from "react";
import { createBrowserRouter } from "react-router";

import { Landing } from "./routes/Landing";

/**
 * Routes past the landing page are split out of the first download.
 *
 * The landing page is what a first-time visitor loads, and it needs none of the
 * document reader, the PDF engine or the chart code. Splitting here keeps that
 * first paint small on a slow connection.
 */
const Demo = lazy(() => import("./routes/Demo").then((module) => ({ default: module.Demo })));
const Login = lazy(() => import("./routes/Login").then((module) => ({ default: module.Login })));
const NotFound = lazy(() =>
  import("./routes/NotFound").then((module) => ({ default: module.NotFound })),
);
const AppShell = lazy(() =>
  import("./routes/app/Shell").then((module) => ({ default: module.AppShell })),
);
const Documents = lazy(() =>
  import("./routes/app/Documents").then((module) => ({ default: module.Documents })),
);
const Chat = lazy(() => import("./routes/app/Chat").then((module) => ({ default: module.Chat })));
const Usage = lazy(() =>
  import("./routes/app/Usage").then((module) => ({ default: module.Usage })),
);
const Settings = lazy(() =>
  import("./routes/app/Settings").then((module) => ({ default: module.Settings })),
);

function Loading() {
  return (
    <div className="flex h-dvh items-center justify-center bg-bg">
      <p className="text-sm text-muted">Loading</p>
    </div>
  );
}

function suspend(node: ReactNode): ReactNode {
  return <Suspense fallback={<Loading />}>{node}</Suspense>;
}

export const router = createBrowserRouter([
  { path: "/", element: <Landing /> },
  { path: "/demo", element: suspend(<Demo />) },
  { path: "/login", element: suspend(<Login />) },
  {
    path: "/app",
    element: suspend(<AppShell />),
    children: [
      { index: true, element: suspend(<Documents />) },
      { path: "chat", element: suspend(<Chat />) },
      { path: "usage", element: suspend(<Usage />) },
      { path: "settings", element: suspend(<Settings />) },
    ],
  },
  { path: "*", element: suspend(<NotFound />) },
]);
