import { useEffect, useState } from "react";
import type { Db } from "../db";
import type { StoredImage } from "../domain/types";
import { getImage, imageDataUrl, saveImage } from "../repo/images";
import { useApp } from "./app";

/** Images wider or taller than this are scaled down when added. */
const MAX_SIDE = 1800;

const cache = new Map<string, Promise<string | null>>();

function loadUrl(db: Db, imageId: string): Promise<string | null> {
  let url = cache.get(imageId);
  if (!url) {
    url = getImage(db, imageId)
      .then((image) => (image ? imageDataUrl(image) : null))
      .catch(() => null);
    cache.set(imageId, url);
  }
  return url;
}

/** The displayable URL of a stored image: undefined while loading, null if it is missing. */
export function useImageUrl(imageId: string | null | undefined): string | null | undefined {
  const { db } = useApp();
  const [url, setUrl] = useState<string | null>();
  useEffect(() => {
    if (!imageId) {
      setUrl(null);
      return;
    }
    let active = true;
    setUrl(undefined);
    void loadUrl(db, imageId).then((value) => active && setUrl(value));
    return () => {
      active = false;
    };
  }, [db, imageId]);
  return url;
}

/** Read an image file, scale it down if it is very large, and store it with the note. */
export async function importImage(db: Db, noteId: string, file: Blob): Promise<StoredImage> {
  if (!file.type.startsWith("image/")) throw new Error("That file is not an image.");
  const source = await decode(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The image could not be read.");
  context.drawImage(source, 0, 0, width, height);

  // Photos compress far better as JPEG; drawings and screenshots stay PNG so text stays sharp.
  const mime = file.type === "image/jpeg" ? "image/jpeg" : "image/png";
  const dataUrl = canvas.toDataURL(mime, 0.86);
  const data = dataUrl.slice(dataUrl.indexOf(",") + 1);

  const image = await saveImage(db, { noteId, mime, data, width, height });
  cache.set(image.id, Promise.resolve(dataUrl));
  return image;
}

function decode(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The image could not be read."));
    };
    image.src = url;
  });
}
