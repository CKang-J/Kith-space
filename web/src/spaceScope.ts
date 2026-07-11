type SpaceHeaderOptions = {
  json?: boolean;
};

type HeaderWriter = {
  setRequestHeader: (name: string, value: string) => void;
};

export function spaceScopeHeaders(token: string, spaceId: string, options: SpaceHeaderOptions = {}) {
  return {
    ...(options.json ? { "content-type": "application/json" } : {}),
    authorization: `Bearer ${token}`,
    "x-space-id": spaceId,
  };
}

export function applySpaceScopeHeaders(target: HeaderWriter, token: string, spaceId: string) {
  const headers = spaceScopeHeaders(token, spaceId);
  Object.entries(headers).forEach(([name, value]) => target.setRequestHeader(name, value));
}
