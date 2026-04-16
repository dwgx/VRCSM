import { useQuery } from "@tanstack/react-query";
import type { UseQueryOptions } from "@tanstack/react-query";
import { ipc } from "@/lib/ipc";

export function useIpcQuery<TParams, TResult>(
  method: string,
  params: TParams,
  options?: Omit<UseQueryOptions<TResult, Error, TResult, [string, TParams]>, "queryKey" | "queryFn">
) {
  return useQuery<TResult, Error, TResult, [string, TParams]>({
    queryKey: [method, params],
    queryFn: () => ipc.call<TParams, TResult>(method, params),
    ...options,
  });
}
