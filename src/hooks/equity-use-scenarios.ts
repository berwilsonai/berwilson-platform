'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Scenario } from '@/types/equity-domain'

export function useScenarios() {
  return useQuery<Pick<Scenario, 'id' | 'name' | 'description' | 'is_baseline' | 'created_at' | 'updated_at' | 'user_id'>[]>({
    queryKey: ['scenarios'],
    queryFn: async () => {
      const res = await fetch('/api/equity/scenarios')
      if (!res.ok) throw new Error('Failed to fetch scenarios')
      return res.json()
    },
  })
}

export function useScenario(id: string | null) {
  return useQuery<Scenario>({
    queryKey: ['scenario', id],
    queryFn: async () => {
      const res = await fetch(`/api/equity/scenarios/${id}`)
      if (!res.ok) throw new Error('Failed to fetch scenario')
      return res.json()
    },
    enabled: !!id,
  })
}

export function useCreateScenario() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (data: Partial<Scenario>) => {
      const res = await fetch('/api/equity/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed to create scenario')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scenarios'] })
    },
  })
}

export function useUpdateScenario() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Record<string, unknown>) => {
      const res = await fetch(`/api/equity/scenarios/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed to update scenario')
      return res.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['scenario', variables.id] })
      queryClient.invalidateQueries({ queryKey: ['scenarios'] })
    },
  })
}

export function useDeleteScenario() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/equity/scenarios/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete scenario')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scenarios'] })
    },
  })
}
