import React from "react"
import { Composition, registerRoot } from "remotion"
import { LabComposition } from "./composition"
import { DIMENSIONS, type LabCompositionProps, TEMPLATES } from "./types"

const defaults: LabCompositionProps = { templateId: "editorial", images: [], title: "My story", format: "9:16" }
function Root() {
  return <Composition id="CreativeLab" component={LabComposition} width={1080} height={1920} fps={30} durationInFrames={360} defaultProps={defaults}
    calculateMetadata={({ props }) => ({ ...DIMENSIONS[props.format], durationInFrames: (TEMPLATES.find(t => t.id === props.templateId)?.duration || 8) * 30 })} />
}
registerRoot(Root)
