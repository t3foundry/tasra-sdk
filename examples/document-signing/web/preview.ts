import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from 'pdfjs-dist'
GlobalWorkerOptions.workerSrc = '/pdf-assets/pdf.worker.mjs'
let documentPromise: Promise<PDFDocumentProxy> | undefined
// The exact bytes hashed by the review screen are also the bytes rendered here.
export async function preview(bytes: Uint8Array) {
  documentPromise ??= getDocument({
    data: Uint8Array.from(bytes),
    cMapUrl: '/pdf-assets/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdf-assets/standard_fonts/',
    wasmUrl: '/pdf-assets/wasm/',
  }).promise
  const pdf = await documentPromise
  const target = document.querySelector<HTMLElement>('#preview')!
  target.innerHTML =
    '<div class="pdf-navigation"><button id="previous-page" class="small">Previous</button><span id="page-number" aria-live="polite"></span><button id="next-page" class="small">Next</button></div><canvas aria-label="PDF page"></canvas><div id="page-text" class="sr-only"></div>'
  let current = 1,
    rendering = false
  const previous = target.querySelector<HTMLButtonElement>('#previous-page')!,
    next = target.querySelector<HTMLButtonElement>('#next-page')!
  async function draw() {
    if (rendering) return
    rendering = true
    previous.disabled = true
    next.disabled = true
    try {
      const page = await pdf.getPage(current),
        canvas = target.querySelector('canvas')!,
        viewport = page.getViewport({ scale: 1.5 })
      canvas.width = viewport.width
      canvas.height = viewport.height
      await page.render({ canvas, viewport }).promise
      target.querySelector('#page-number')!.textContent =
        `Page ${current} of ${pdf.numPages}`
      const text = await page.getTextContent()
      target.querySelector('#page-text')!.textContent = text.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
      target.dataset.ready = 'true'
    } finally {
      rendering = false
      previous.disabled = current === 1
      next.disabled = current === pdf.numPages
    }
  }
  previous.onclick = () => {
    if (current > 1 && !rendering) {
      current--
      void draw().catch((e) => {
        target.textContent = String(e)
      })
    }
  }
  next.onclick = () => {
    if (current < pdf.numPages && !rendering) {
      current++
      void draw().catch((e) => {
        target.textContent = String(e)
      })
    }
  }
  await draw()
}
