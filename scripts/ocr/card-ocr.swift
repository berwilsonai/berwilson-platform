// bw-ocr — local text recognition for scanned documents and photographed cards.
//
// Uses Apple's Vision framework (VNRecognizeTextRequest), which ships with
// macOS: no model download, no RAM held resident, nothing leaves the machine.
// Same posture and the same spawn-a-system-binary pattern as whisper.cpp /
// afconvert in src/lib/ai/whisper.ts.
//
// Build:  zsh scripts/build-ocr.sh     (installs to ~/.local/bin/bw-ocr)
// Usage:  bw-ocr <image-or-pdf-path> [--dpi N] [--max-pages N]
//         → recognized text on stdout; PDFs get a "--- page N ---" marker per page
//
// Reads images through ImageIO rather than NSImage so the EXIF orientation tag
// is honoured — a photo taken on a phone held sideways is otherwise fed to
// Vision rotated, and rotated text does not recognize.
//
// PDFs (added 2026-09-26): ImageIO cannot decode a PDF at all, so a scanned
// lease reached Vision as "unsupported format" and 30 of the platform's PDFs
// held no text. Each page is rendered through CGContext at a chosen DPI and
// recognized separately. The DPI is the whole game: a 72-DPI render of the
// Alaska upland mining lease recognized its body text but is marginal on small
// print, while 200 DPI is reliable — and the figure that mattered, "containing
// approximately 665 acres", is in exactly that register.

import Foundation
import Vision
import ImageIO
import CoreGraphics

func fail(_ msg: String, _ code: Int32) -> Never {
  FileHandle.standardError.write("bw-ocr: \(msg)\n".data(using: .utf8)!)
  exit(code)
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

var path: String? = nil
var dpi: CGFloat = 200
var maxPages = 300

var argv = Array(CommandLine.arguments.dropFirst())
var i = 0
while i < argv.count {
  switch argv[i] {
  case "--dpi":
    i += 1
    guard i < argv.count, let v = Double(argv[i]), v >= 36, v <= 600 else {
      fail("--dpi takes a number between 36 and 600", 2)
    }
    dpi = CGFloat(v)
  case "--max-pages":
    i += 1
    guard i < argv.count, let v = Int(argv[i]), v > 0 else {
      fail("--max-pages takes a positive number", 2)
    }
    maxPages = v
  default:
    if path == nil { path = argv[i] } else { fail("unexpected argument: \(argv[i])", 2) }
  }
  i += 1
}

guard let path else { fail("usage: bw-ocr <image-or-pdf-path> [--dpi N] [--max-pages N]", 2) }
let url = URL(fileURLWithPath: path)

// ---------------------------------------------------------------------------
// Recognition
// ---------------------------------------------------------------------------

func recognize(_ cgImage: CGImage, orientation: CGImagePropertyOrientation) -> [String] {
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = true
  request.recognitionLanguages = ["en-US"]

  let handler = VNImageRequestHandler(cgImage: cgImage, orientation: orientation, options: [:])
  do {
    try handler.perform([request])
  } catch {
    fail("recognition failed: \(error.localizedDescription)", 4)
  }
  return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
}

// ---------------------------------------------------------------------------
// PDF: render each page, then recognize it
// ---------------------------------------------------------------------------

func renderPage(_ page: CGPDFPage, dpi: CGFloat) -> CGImage? {
  // .cropBox is what a reader sees; .mediaBox can carry printer bleed that
  // pads the render with blank margins and shrinks the text.
  let box = page.getBoxRect(.cropBox)
  guard box.width > 0, box.height > 0 else { return nil }

  let scale = dpi / 72.0   // PDF user space is 72 units per inch
  let width = Int((box.width * scale).rounded())
  let height = Int((box.height * scale).rounded())
  guard width > 0, height > 0, width < 20000, height < 20000 else { return nil }

  guard let context = CGContext(
    data: nil,
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: 0,
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
  ) else { return nil }

  // A scanned page is often transparent where it is white; Vision reads dark
  // text on light ground, so the page is filled white before drawing.
  context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
  context.fill(CGRect(x: 0, y: 0, width: width, height: height))

  context.scaleBy(x: scale, y: scale)
  context.translateBy(x: -box.origin.x, y: -box.origin.y)
  // Honour /Rotate — a landscape scan stored rotated recognizes as nothing.
  context.drawPDFPage(page)

  return context.makeImage()
}

if let pdf = CGPDFDocument(url as CFURL) {
  let pageCount = min(pdf.numberOfPages, maxPages)
  guard pageCount > 0 else { fail("PDF has no pages", 3) }

  var out: [String] = []
  var recognizedPages = 0
  for n in 1...pageCount {
    guard let page = pdf.page(at: n), let image = renderPage(page, dpi: dpi) else { continue }
    let lines = recognize(image, orientation: .up)
    guard !lines.isEmpty else { continue }
    recognizedPages += 1
    out.append("--- page \(n) ---")
    out.append(lines.joined(separator: "\n"))
  }

  if pdf.numberOfPages > pageCount {
    out.append("--- page limit reached: \(pageCount) of \(pdf.numberOfPages) pages recognized ---")
  }

  // Exit 5 distinguishes "read the file, found no text" from "could not read
  // the file" (3). A blank scan is a fact about the document; the caller needs
  // to store that rather than retry it forever.
  guard recognizedPages > 0 else { fail("no text recognized on any of \(pageCount) page(s)", 5) }
  print(out.joined(separator: "\n\n"))
  exit(0)
}

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
      let cgImage = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
  fail("could not decode image (unsupported format?)", 3)
}

// EXIF orientation (1–8); Vision takes the same numbering.
let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any]
let exif = (props?[kCGImagePropertyOrientation] as? UInt32) ?? 1
let orientation = CGImagePropertyOrientation(rawValue: exif) ?? .up

let lines = recognize(cgImage, orientation: orientation)
guard !lines.isEmpty else { fail("no text recognized in image", 5) }
print(lines.joined(separator: "\n"))
