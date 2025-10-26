import ReaderWorkspace from "@/app/components/workspace/ReaderWorkspace";

interface PaperWorkspaceProps {
  params: Promise<{
    paperId: string;
  }>;
}

export const dynamic = "force-dynamic";

export default async function PaperWorkspace({ params }: PaperWorkspaceProps) {
  const { paperId } = await params;
  const decodedId = decodeURIComponent(paperId);
  return <ReaderWorkspace paperId={decodedId} />;
}
