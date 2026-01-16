import React from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter, createRootRoute, createRoute, Outlet, redirect, Link } from "@tanstack/react-router";
import "./index.css";

// Import pages
import { LoginPage } from "./routes/login";
import { RegisterPage } from "./routes/register";
import { DashboardPage } from "./routes/dashboard";
import { ProjectPage } from "./routes/project";
import { useSession } from "./lib/auth-client";
import { ThemeProvider } from "./components/theme-provider";

// Root layout component
function RootLayout() {
  return (
    <div className="min-h-screen bg-background">
      <Outlet />
    </div>
  );
}

// Landing page
function LandingPage() {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (session) {
    return <DashboardPage />;
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <div className="text-center space-y-6 max-w-2xl">
        <h1 className="text-4xl font-bold tracking-tight">Open Dev</h1>
        <p className="text-xl text-muted-foreground">
          AI-powered project planning. Create tasks, collaborate with AI, and manage your projects with ease.
        </p>
        <div className="flex gap-4 justify-center">
          <Link
            to="/login"
            className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
          >
            Sign In
          </Link>
          <Link
            to="/register"
            className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2"
          >
            Create Account
          </Link>
        </div>
      </div>
    </div>
  );
}

// Create routes
const rootRoute = createRootRoute({
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: LandingPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/register",
  component: RegisterPage,
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dashboard",
  component: DashboardPage,
});

const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/project/$projectId",
  component: ProjectPage,
});

// Create route tree
const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  registerRoute,
  dashboardRoute,
  projectRoute,
]);

// Create router
const router = createRouter({ routeTree });

// Type registration
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// Mount app
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  </React.StrictMode>
);
