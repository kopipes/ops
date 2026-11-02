import { CrewReportPage, phaseMetadata } from "@/components/crew/CrewReportPage";

export const metadata = phaseMetadata("closing");

export default async function Page({
  params,
}: {
  params: Promise<{ id: string; date: string }>;
}) {
  const { id, date } = await params;
  return <CrewReportPage projectId={id} date={date} phase="closing" />;
}
