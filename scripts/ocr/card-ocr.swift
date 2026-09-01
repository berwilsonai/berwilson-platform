// bw-ocr — local text recognition for the business-card scanner.
//
// Uses Apple's Vision framework (VNRecognizeTextRequest), which ships with
// macOS: no model download, no RAM held resident, nothing leaves the machine.
// Same posture and the same spawn-a-system-binary pattern as whisper.cpp /
// afconvert in src/lib/ai/whisper.ts.
//
// Build:  zsh scripts/build-ocr.sh     (installs to ~/.local/bin/bw-ocr)
// Usage:  bw-ocr <image-path>          → recognized lines on stdout, one per line
//
// Reads the image through ImageIO rather than NSImage so the EXIF orientation
// tag is honoured — a photo taken on a phone held sideways is otherwise fed to
// Vision rotated, and rotated text does not recognize.

import Foundation
import Vision
import ImageIO
import CoreGraphics

func fail(_ msg: String, _ code: Int32) -> Never {
  FileHandle.standardError.write("bw-ocr: \(msg)\n".data(using: .utf8)!)
  exit(code)
}

guard CommandLine.arguments.count > 1 else { fail("usage: bw-ocr <image-path>", 2) }
let url = URL(fileURLWithPath: CommandLine.arguments[1])

guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
      let cgImage = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
  fail("could not decode image (unsupported format?)", 3)
}

// EXIF orientation (1–8); Vision takes the same numbering.
let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any]
let exif = (props?[kCGImagePropertyOrientation] as? UInt32) ?? 1
let orientation = CGImagePropertyOrientation(rawValue: exif) ?? .up

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate          // slower path, but a card is one small image
request.usesLanguageCorrection = true
request.recognitionLanguages = ["en-US"]

let handler = VNImageRequestHandler(cgImage: cgImage, orientation: orientation, options: [:])
do {
  try handler.perform([request])
} catch {
  fail("recognition failed: \(error.localizedDescription)", 4)
}

let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
print(lines.joined(separator: "\n"))
