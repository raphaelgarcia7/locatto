import { useEffect, useRef, useState } from 'react';

type SelectedPhoto = { file: File; preview: string };

export function ProductPhotoPicker({
  onChange,
  kind = 'products',
}: {
  onChange: (files: File[]) => void;
  kind?: 'products' | 'kits';
}) {
  const [photos, setPhotos] = useState<SelectedPhoto[]>([]);
  const [error, setError] = useState('');
  const urls = useRef(new Set<string>());
  useEffect(() => {
    const current = urls.current;
    return () => current.forEach((url) => URL.revokeObjectURL(url));
  }, []);
  return (
    <section
      className="catalog-initial-photos"
      aria-labelledby="initial-photos-title"
    >
      <h3 id="initial-photos-title">
        Fotos do {kind === 'kits' ? 'kit' : 'produto'}
      </h3>
      <p className="catalog-help">
        Adicione até 10 fotos JPEG, PNG ou WebP, com até 10 MiB cada. A primeira
        será a foto principal. As imagens são privadas e otimizadas ao salvar.
      </p>
      <label>
        Adicionar fotos
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            if (files.length + photos.length > 10) {
              setError('Selecione no máximo 10 fotos neste cadastro.');
              return;
            }
            if (
              files.some(
                (file) =>
                  !['image/jpeg', 'image/png', 'image/webp'].includes(
                    file.type,
                  ) || file.size > 10 * 1024 * 1024,
              )
            ) {
              setError('Use fotos JPEG, PNG ou WebP de até 10 MiB cada.');
              return;
            }
            setError('');
            const next = [
              ...photos,
              ...files.map((file) => {
                const preview = URL.createObjectURL(file);
                urls.current.add(preview);
                return { file, preview };
              }),
            ];
            setPhotos(next);
            onChange(next.map((photo) => photo.file));
          }}
        />
      </label>
      {error && (
        <p role="alert" className="auth-feedback auth-feedback--error">
          {error}
        </p>
      )}
      {photos.length > 0 && (
        <ul className="catalog-photo-drafts">
          {photos.map((photo, index) => (
            <li key={photo.preview}>
              <img src={photo.preview} alt={`Prévia da foto ${index + 1}`} />
              <span>
                {index === 0 ? 'Foto principal' : `Foto ${index + 1}`}
              </span>
              <button
                type="button"
                className="auth-retry auth-danger"
                aria-label={`Remover foto ${index + 1}`}
                onClick={() => {
                  URL.revokeObjectURL(photo.preview);
                  urls.current.delete(photo.preview);
                  const next = photos.filter((item) => item !== photo);
                  setPhotos(next);
                  onChange(next.map((item) => item.file));
                }}
              >
                Remover
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
