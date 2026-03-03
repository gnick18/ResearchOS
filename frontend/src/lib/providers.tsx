"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect, type ReactNode } from "react";
import { usersApi } from "@/lib/api";
import UserLoginScreen from "@/components/UserLoginScreen";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 0,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  const [checkingUser, setCheckingUser] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    checkUser();
  }, []);

  const checkUser = async () => {
    try {
      const result = await usersApi.validate();
      if (result.valid) {
        setIsLoggedIn(true);
      } else {
        setIsLoggedIn(false);
      }
    } catch (err) {
      // If the API fails, assume not logged in
      setIsLoggedIn(false);
    } finally {
      setCheckingUser(false);
    }
  };

  const handleLogin = () => {
    setIsLoggedIn(true);
    // Invalidate all queries to refresh data for the new user
    queryClient.invalidateQueries();
  };

  // Show loading state while checking user
  if (checkingUser) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg mb-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
          </div>
          <p className="text-slate-400">Loading ResearchOS...</p>
        </div>
      </div>
    );
  }

  // Show login screen if not logged in
  if (!isLoggedIn) {
    return <UserLoginScreen onLogin={handleLogin} />;
  }

  // Show main app if logged in
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
