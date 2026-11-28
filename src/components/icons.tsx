/** Minimal inline stroke icon set (24×24 grid, currentColor). Presentation only. */
import type { SVGProps } from 'react';

const P = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  graph: 'M5 6a2 2 0 1 0 4 0 2 2 0 0 0-4 0Zm10 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0ZM10 18a2 2 0 1 0 4 0 2 2 0 0 0-4 0ZM9 6h6M8 8l3 8m5-8-3 8',
  pen: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4',
  shapes: 'M3 4h7v7H3zM14 14h7v7h-7zM17.5 3 21 9h-7zM6.5 14a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z',
  rocket: 'M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2m-1-4 3 3m3.5-12.5C17 3 21 3 21 3s0 4-1.5 7.5L13 17l-6-6zM15 9a1 1 0 1 0 0-.01',
  pulse: 'M3 12h4l2-6 4 12 2-6h6',
  flask: 'M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3M7.5 15h9',
  music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm11-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  download: 'M12 4v11m0 0 4-4m-4 4-4-4M5 20h14',
  upload: 'M12 16V5m0 0 4 4m-4-4-4 4M5 20h14',
  play: 'M7 4.5v15l12-7.5z',
  pause: 'M8 5v14M16 5v14',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-11v6m0-9v.01',
  alert: 'M12 4 2.5 20h19zM12 10v4m0 3v.01',
  check: 'M5 12.5 10 17l9-10',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-2.5-11.5A2.5 2.5 0 1 1 13 12c-.6.3-1 .8-1 1.5v.5m0 3v.01',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  inbox: 'M3 13h5l1.5 3h5L16 13h5M5 5h14l2 8v6H3v-6z',
  arrowRight: 'M5 12h14m0 0-5-5m5 5-5 5',
  arrowLeft: 'M19 12H5m0 0 5-5m-5 5 5 5',
  x: 'M6 6l12 12M18 6 6 18',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm9 3-4.5-4.5',
  filter: 'M4 5h16l-6 7.5V19l-4 1v-7.5z',
  maximize: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  minimize: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  fit: 'M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5M9 9h6v6H9z',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M21.5 20a6.5 6.5 0 0 0-4-6',
  repeat: 'M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3m13-3v2a4 4 0 0 1-4 4H4',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5l3 2',
  branch: 'M6 3v12m0 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm12-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 0a9 9 0 0 1-9 9',
  layers: 'M12 3 2 8.5 12 14l10-5.5zM2 13.5 12 19l10-5.5',
  file: 'M6 3h8l5 5v13H6zM14 3v5h5',
  table: 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v14',
  chevronDown: 'm6 9 6 6 6-6',
  chevronRight: 'm9 6 6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  link: 'M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-4a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-4a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  compare: 'M7 4v16M17 4v16M3 8h8M13 16h8',
  gauge: 'M4 18a8 8 0 1 1 16 0M12 18l4-6',
  route: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm12-10a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM8 17h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  rewind: 'M11 19 4 12l7-7zM20 19l-7-7 7-7z',
  skip: 'M5 5l10 7-10 7zM19 5v14',
  sliders: 'M4 6h10m4 0h2M4 12h4m4 0h8M4 18h12m4 0h0M14 4v4M8 10v4M16 16v4',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  edit: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z',
};

export const ICON_NAMES = P;
export type IconName = keyof typeof P;

export function Icon({ name, className, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className ?? 'h-4 w-4'}
      {...props}
    >
      <path d={P[name]} />
    </svg>
  );
}
