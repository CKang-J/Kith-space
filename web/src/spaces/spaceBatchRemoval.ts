export interface SpaceRemovalResult {
  ok: boolean;
  error?: string;
}

export async function removeSpacesInOrder(
  spaceIds: readonly string[],
  removeSpace: (spaceId: string) => Promise<SpaceRemovalResult>,
): Promise<{ removedIds: string[]; failedIds: string[] }> {
  const removedIds: string[] = [];
  const failedIds: string[] = [];

  for (const spaceId of spaceIds) {
    try {
      const result = await removeSpace(spaceId);
      if (result.ok) removedIds.push(spaceId);
      else failedIds.push(spaceId);
    } catch {
      failedIds.push(spaceId);
    }
  }

  return { removedIds, failedIds };
}
