/** Resize/re-encode upload images so posters stay light (max width 300px, JPEG). */
export async function prepareUploadImage(file: File, maxWidth = 300): Promise<File> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Valitse kuvatiedosto.');
  }

  const bitmap = await createImageBitmap(file);
  try {
    const scale = bitmap.width > maxWidth ? maxWidth / bitmap.width : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Kuvan käsittely epäonnistui.');
    }
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Kuvan käsittely epäonnistui.'))),
        'image/jpeg',
        0.85
      );
    });

    const base = file.name.replace(/\.[^.]+$/, '') || 'image';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}
