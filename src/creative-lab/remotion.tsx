import React from "react"
import { Composition, registerRoot } from "remotion"
import { LabRemotionComposition, type LabRemotionProps } from "./composition"
import { DIMENSIONS, type LabFormat } from "./types"

/* Второй движок Creative Lab рядом с Hyperframes: шаблон с `engine: "remotion"`
   в каталоге рендерится этой композицией (worker → @remotion/renderer).
   Длительность: 1.3 с на фото + 2.5 с финального блока. */
const defaults: LabRemotionProps = { templateId: "remotion", photos: [], fields: {}, theme: "dark", format: "9:16" }
function Root() {
  return <Composition id="CreativeLab" component={LabRemotionComposition} width={1080} height={1920} fps={30} durationInFrames={150} defaultProps={defaults}
    calculateMetadata={({ props }) => ({ ...DIMENSIONS[(props.format as LabFormat) in DIMENSIONS ? props.format as LabFormat : "9:16"], durationInFrames: Math.round((Math.max(1, props.photos.length) * 1.3 + 2.5) * 30) })} />
}
registerRoot(Root)
