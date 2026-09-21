const paths = {
  write: 'M7 3h7l5 5v13H5V3h2m7 0v6h5M8 13h8m-8 4h5',
  modify: 'm14 5 5 5M4 20l5-1L21 7l-5-5L4 14v6Z',
  organize: 'M3 7V4h6l3 3h9v13H3V7Zm0 3h18',
  analyze: 'M4 3v18h17M8 17v-5m5 5V8m5 9V4',
  build: 'M5 3h14v18H5V3Zm3 5h1m3 0h4m-8 4h1m3 0h4m-8 4h1m3 0h4',
  free: 'M4 4h16v13H10l-6 4V4Zm4 5h8m-8 4h5',
};

export function HomeTaskIcon({ kind }: { kind: keyof typeof paths }) {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="2" width="13" height="14" rx="4" fill="var(--accent)" opacity=".18" />
      <path
        d={paths[kind]}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="20" cy="20" r="2" fill="var(--accent)" />
    </svg>
  );
}
