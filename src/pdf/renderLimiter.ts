// Drawing many pages at once spikes memory on phones. Pages wait for a slot;
// the newest request goes first, because while scrolling quickly the page
// asked for last is the one now on screen.

const MAX_CONCURRENT = 2

let running = 0
const waiting: Array<() => void> = []

export function acquireRenderSlot(signal: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }

    const grant = () => {
      running += 1
      let released = false
      resolve(() => {
        if (released) return
        released = true
        running -= 1
        waiting.pop()?.()
      })
    }

    if (running < MAX_CONCURRENT) {
      grant()
      return
    }

    const onAbort = () => {
      const index = waiting.indexOf(start)
      if (index !== -1) waiting.splice(index, 1)
      reject(signal.reason)
    }
    const start = () => {
      signal.removeEventListener('abort', onAbort)
      grant()
    }
    waiting.push(start)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
