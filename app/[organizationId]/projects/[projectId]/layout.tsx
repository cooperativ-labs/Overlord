import { redirect } from 'next/navigation';

type LayoutProps = {
  params: Promise<{ projectId: string }>;
};

export default async function OldProjectLayout({ params }: LayoutProps) {
  const { projectId } = await params;
  redirect(`/projects/${projectId}`);
}
