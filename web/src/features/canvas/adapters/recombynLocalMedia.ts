/*
 * Stage 1 local-only media helpers. These deliberately accept no HTTP(S) or
 * Recombyn upload URL so generator interactions cannot cross the host seam.
 */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      if (result) resolve(result);
      else reject(new Error("empty file preview"));
    };
    reader.onerror = () => reject(new Error("failed to read local media file"));
    reader.readAsDataURL(file);
  });
}

export async function imageSrcToFile(
  source: string,
  filename = "image.png",
  options?: { fallbackMime?: string },
): Promise<File> {
  const value = String(source || "").trim();
  if (!value.startsWith("data:") && !value.startsWith("blob:")) {
    throw new Error("Stage 1 accepts only local image references");
  }
  const response = await fetch(value);
  if (!response.ok) throw new Error("failed to read local image reference");
  const blob = await response.blob();
  const type = blob.type || options?.fallbackMime || "image/png";
  return new File([blob], filename, { type });
}
