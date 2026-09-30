import { Logo } from '@/components/app/Logo';

/** T00 placeholder home. The real public home is built in T27 (08-ux-ui §6.1). */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[1180px] flex-col px-5 py-8 lg:px-12">
      <h1 className="text-[20px] leading-[1.3] lg:text-[26px]">
        <Logo />
      </h1>
    </main>
  );
}
