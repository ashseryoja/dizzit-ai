import { notFound } from "next/navigation"
import { LabEditor } from "@/components/creative-lab/editor"
import { TEMPLATES } from "@/creative-lab/types"

export default async function TemplatePage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params
  const template = TEMPLATES.find(t => t.id === templateId)
  if (!template) notFound()
  return <LabEditor key={template.id} template={template} />
}
