import { useQuery } from "@tanstack/react-query";
import { api } from "@/ipc/client";

export function useAboutInfo() {
  return useQuery({
    queryKey: ["about_info"],
    queryFn: api.aboutInfo,
    staleTime: Infinity,
  });
}
