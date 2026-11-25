import { useEffect, useRef } from 'react'

// Android's back button (and the browser's) should close whatever is on top,
// a sheet first and then the open book, instead of leaving the site. Each open
// layer pushes a history entry; going back pops the newest layer.

interface Layer {
  onBack: () => void
}

const layers: Layer[] = []
let ignoredPops = 0

window.addEventListener('popstate', () => {
  if (ignoredPops > 0) {
    ignoredPops -= 1
    return
  }
  layers.pop()?.onBack()
})

export function useBackHandler(active: boolean, onBack: () => void) {
  const onBackRef = useRef(onBack)
  useEffect(() => {
    onBackRef.current = onBack
  })

  useEffect(() => {
    if (!active) return
    let closedByBack = false
    const layer: Layer = {
      onBack: () => {
        closedByBack = true
        onBackRef.current()
      },
    }
    layers.push(layer)
    history.pushState({ mossreadLayer: layers.length }, '')

    return () => {
      if (closedByBack) return
      // Closed from the UI: drop the history entry this layer added.
      const index = layers.indexOf(layer)
      if (index === -1) return
      layers.splice(index, 1)
      ignoredPops += 1
      history.back()
    }
  }, [active])
}
