import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { Landing, LoginPage } from "./pages/Login";
import StaffApp from "./pages/StaffApp";
import MerchantApp from "./pages/MerchantApp";
import MemberApp from "./pages/MemberApp";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/login/:portal" component={LoginPage} />
      <Route path="/staff" component={StaffApp} />
      <Route path="/staff/:tab" component={StaffApp} />
      <Route path="/merchant" component={MerchantApp} />
      <Route path="/merchant/:tab" component={MerchantApp} />
      <Route path="/member" component={MemberApp} />
      <Route path="/member/:tab" component={MemberApp} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster position="top-center" />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
