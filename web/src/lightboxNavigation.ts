export function adjacentImageId(
  images: readonly { id: string }[],
  currentImageId: string,
  delta: -1 | 1,
): string | null {
  const currentIndex = images.findIndex((image) => image.id === currentImageId);
  if (currentIndex < 0) return null;
  return images[currentIndex + delta]?.id ?? null;
}
