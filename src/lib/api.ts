const apiBase = (import.meta.env.VITE_TRU_API_BASE || "https://tru-joesplashy.zocomputer.io").replace(/\/+$/, "");

export function apiUrl(path: string): string {
  const normalised = path.startsWith("/") ? path : `/${path}`;
  return `${apiBase}${normalised}`;
}

export function siteUrl(path = "/"): string {
  const base = import.meta.env.BASE_URL || "/";
  const cleanBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${cleanBase}${cleanPath}` || "/";
}
