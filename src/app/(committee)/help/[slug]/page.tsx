import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Markdown } from '@/components/app/Markdown';
import { requirePageUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { getHelpPage } from '@/server/services/content.service';

export const metadata: Metadata = { title: 'คู่มือ · AZIZSTAN ZERO WASTE' };

export default async function HelpArticle({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requirePageUser(`/help/${slug}`);
  const page = await getHelpPage(getDb(), user, slug);
  if (!page) notFound();
  return (
    <main className="mx-auto flex max-w-[720px] flex-col gap-4 px-5 py-6">
      <Link href="/help" className="text-[14px] text-brand-ink underline">
        ← คู่มือ
      </Link>
      <h1 className="text-[22px] leading-[1.3] font-bold">{page.title}</h1>
      <article>
        <Markdown source={page.bodyMd} />
      </article>
    </main>
  );
}
