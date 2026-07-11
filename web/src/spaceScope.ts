type SpaceHeaderOptions = {
  method?: string;
  csrfToken?: string;
  json?: boolean;
};

type HeaderWriter = {
  setRequestHeader: (name: string, value: string) => void;
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function spaceScopeHeaders(spaceId: string, options: SpaceHeaderOptions = {}) {
  const method = (options.method ?? "GET").toUpperCase();
  const unsafe = !SAFE_METHODS.has(method);
  if (unsafe && !options.csrfToken) throw new Error("Missing browser session CSRF token");

  return {
    ...(options.json ? { "content-type": "application/json" } : {}),
    ...(unsafe ? { "x-kith-csrf": options.csrfToken! } : {}),
    "x-space-id": spaceId,
  };
}

export function applySpaceScopeHeaders(target: HeaderWriter, spaceId: string, options: SpaceHeaderOptions = {}) {
  const headers = spaceScopeHeaders(spaceId, options);
  Object.entries(headers).forEach(([name, value]) => target.setRequestHeader(name, value));
}
