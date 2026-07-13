export interface HostDirectoryListing {
  path: string;
  parentPath: string | null;
  roots: string[];
  entries: Array<{ name: string; path: string }>;
}

export async function fetchHostDirectories(path?: string): Promise<HostDirectoryListing> {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  const response = await fetch(`/api/host-directories${query}`, { credentials: "same-origin" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Host directory browse failed (${response.status})`);
  return body as HostDirectoryListing;
}
