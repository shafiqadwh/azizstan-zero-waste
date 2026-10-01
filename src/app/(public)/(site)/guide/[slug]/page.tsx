import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Markdown } from '@/components/app/Markdown';
import { publicGuidePage } from '@/server/public-cache';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const page = await publicGuidePage((await params).slug);
  return { title: `${page?.title ?? 'คู่มือ'} · AZIZSTAN ZERO WASTE` };
}

export default async function GuideArticle({ params }: { params: Promise<{ slug: string }> }) {
  const page = await publicGuidePage((await params).slug);
  if (!page) notFound();
  return (
    <main className="mx-auto flex max-w-[720px] flex-col gap-4 px-5 py-6 lg:py-8">
      <Link href="/guide" className="text-[14px] text-brand-ink underline">
        ← วิธีการใช้งาน
      </Link>
      <h1 className="text-[22px] leading-[1.3] font-bold lg:text-[26px]">{page.title}</h1>
      <article>
        <Markdown source={page.bodyMd} />
      </article>
    </main>
  );
}
