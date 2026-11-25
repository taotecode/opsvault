import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { api, type ApiError } from './api';
import type { MeResponse, SetupStatus } from '@/types';

export interface AppSettings {
  security: { sessionDays: number; forceTotp: boolean; revealWindowMinutes: number; loginLockout: boolean };
  probe: { schedule: string; concurrency: number; timeoutSec: number; snapshotKeep: number };
  notifications: { expiryDays: number; webhookUrl: string };
  system: { updateChannel: string };
}

export function useMe(): UseQueryResult<MeResponse, ApiError> {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<MeResponse>('/api/v1/auth/me'),
    retry: false,
    staleTime: 30_000,
  });
}

export function useSettings(): UseQueryResult<AppSettings, ApiError> {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<AppSettings>('/api/v1/settings'),
    staleTime: 30_000,
  });
}

export function useSetupStatus(): UseQueryResult<SetupStatus, ApiError> {
  return useQuery({
    queryKey: ['setup-status'],
    queryFn: () => api.get<SetupStatus>('/api/v1/setup/status'),
    retry: false,
    staleTime: 10_000,
  });
}
