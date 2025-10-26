import ReaderWorkspace from "@/app/components/workspace/ReaderWorkspace";

interface PaperWorkspaceProps {
  params: {
    paperId: string;
  };
}

export const dynamic = "force-dynamic";

export default function PaperWorkspace({ params }: PaperWorkspaceProps) {
  const decodedId = decodeURIComponent(params.paperId);
  return <ReaderWorkspace paperId={decodedId} />;
}
