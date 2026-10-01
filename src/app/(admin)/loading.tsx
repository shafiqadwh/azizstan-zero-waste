/** 08-ux-ui §7 Loading: skeletons shaped like the content, no spinners. */
export default function AdminLoading() {
  return (
    <main
      aria-busy="true"
      aria-label="กำลังโหลด"
      className="mx-auto flex max-w-[1180px] flex-col gap-4 px-5 py-8 lg:px-12"
    >
      <div className="h-8 w-64 animate-pulse rounded-md bg-surface-muted" />
      <div className="h-4 w-40 animate-pulse rounded-md bg-surface-muted" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-28 animate-pulse rounded-xl border border-line bg-surface" />
      ))}
    </main>
  );
}
