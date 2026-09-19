"use client"
import { Player } from "@remotion/player"
import { LabComposition } from "@/creative-lab/composition"
import { DIMENSIONS, type LabCompositionProps } from "@/creative-lab/types"

export default function LabPreview({ duration, ...props }: LabCompositionProps & { duration: number }) {
  const dimensions = DIMENSIONS[props.format]
  return <Player component={LabComposition} inputProps={props} durationInFrames={duration * 30} initialFrame={15} fps={30} compositionWidth={dimensions.width} compositionHeight={dimensions.height} controls loop style={{ width: "100%", maxHeight: "65vh", aspectRatio: `${dimensions.width}/${dimensions.height}` }} errorFallback={() => <div className="lab-notice">Не удалось открыть предпросмотр. Замените повреждённую фотографию.</div>} />
}
