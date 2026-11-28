import { useEffect, useState } from 'react';
import { parseManifest, type FestivalManifest } from './adapter';

export type ManifestState =
  | { status: 'loading' }
  | { status: 'missing'; message: string }
  | { status: 'ready'; manifest: FestivalManifest; warnings: string[] };

/** Loads public/datasets/dataset_manifest.json (published by the data track). */
export function useFestivalManifest(): ManifestState {
  const [state, setState] = useState<ManifestState>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}datasets/dataset_manifest.json`, { cache: 'no-cache' })
      .then(async (res) => {
        const type = res.headers.get('content-type') ?? '';
        if (!res.ok || !type.includes('json')) throw new Error('dataset_manifest.json is not published yet.');
        const { manifest, errors } = parseManifest(await res.json());
        if (!manifest) throw new Error(`Invalid dataset_manifest.json: ${errors.join(' ')}`);
        if (!cancelled) setState({ status: 'ready', manifest, warnings: errors });
      })
      .catch((e: unknown) => !cancelled && setState({ status: 'missing', message: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
