"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { auth } from "@/lib/firebase/client";

type AuthContextValue = {
  currentUser: User | null;
  isAuthLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(Boolean(auth));

  useEffect(() => {
    if (!auth) {
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setIsAuthLoading(false);
    });

    return unsubscribe;
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    return {
      currentUser,
      isAuthLoading,
      login: async (email: string, password: string) => {
        if (!auth) {
          throw new Error("Firebase is not configured");
        }

        await signInWithEmailAndPassword(auth, email.trim(), password);
      },
      logout: async () => {
        if (!auth) {
          return;
        }

        await signOut(auth);
      },
    };
  }, [currentUser, isAuthLoading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}
