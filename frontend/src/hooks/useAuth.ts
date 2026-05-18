import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react';
import { authApi } from '../api';
import type { User, Token } from '../types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    const role = localStorage.getItem('user_role');
    const username = localStorage.getItem('username');

    if (token && role && username) {
      setUser({ username, role });
    }
    setLoading(false);
  }, []);

  const login = async (username: string, password: string): Promise<void> => {
    try {
      const tokenData: Token = await authApi.login({ username, password });
      
      localStorage.setItem('access_token', tokenData.access_token);
      localStorage.setItem('user_role', tokenData.role);
      localStorage.setItem('username', tokenData.username);
      
      setUser({ username: tokenData.username, role: tokenData.role });
    } catch (error) {
      throw new Error('Неверный логин или пароль');
    }
  };

  const logout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user_role');
    localStorage.removeItem('username');
    setUser(null);
  };

  return createElement(AuthContext.Provider, { value: { user, loading, login, logout } }, children);
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
