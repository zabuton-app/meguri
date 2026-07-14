import { useQuery } from "@tanstack/react-query";
import { api } from "@/ipc/client";

export function useAppStatus() {
  return useQuery({ queryKey: ["app_status"], queryFn: api.appStatus });
}
