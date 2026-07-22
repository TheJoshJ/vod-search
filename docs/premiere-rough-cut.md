# Premiere rough-cut interchange

VOD Search exports a Final Cut Pro 7 XML interchange document (`xmeml` version 5) plus a `.roughcut.json` sidecar. It does not attempt to create Adobe's native `.prproj` format.

## Why Final Cut Pro 7 XML

- Adobe documents importing standard Final Cut Pro XML projects and sequences into Premiere, including sequence settings, track layout, and timecode. Modern Final Cut Pro X `.fcpxml` is a different format and Adobe says it requires conversion before Premiere can import it.
- XML can carry linked video and audio clip items, source paths, source in/out points, and a complete ordered sequence.
- CMX 3600 EDL is useful for very simple interchange, but Adobe describes it as best suited to a limited track layout and timecode-oriented media. It is retained as a possible future fallback, not the primary export.
- The companion JSON preserves the editor brief, retrieved-source decisions, millisecond timing, handles, ordering, and rationale without relying on NLE-specific translation.

Primary references:

- [Adobe: importing Final Cut Pro XML](https://helpx.adobe.com/lt/premiere-pro/using/importing-xml-project-files-final.html)
- [Adobe: supported direct export formats](https://helpx.adobe.com/premiere/desktop/render-and-export/export-files/supported-export-file-formats.html)
- [Adobe: CMX 3600 EDL guidance](https://helpx.adobe.com/premiere/desktop/render-and-export/export-files/export-a-project-as-an-edl-file.html)
- [Apple: Final Cut Pro 7 XML encoding basics](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/FinalCutPro_XML/Basics/Basics.html)
- [Apple: XMEML frame-rate mappings](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/FinalCutPro_XML/FrameRate/FrameRate.html)

## Premiere workflow

1. Generate and review the paper edit in VOD Search.
2. Export the XML. VOD Search writes the JSON sidecar beside it.
3. In Premiere, choose **File > Import** and select the `.xml` file.
4. Open the imported sequence and relink source media if its location changed after export.

## Intentional limits

- The first version exports one straight-cut video track and one linked stereo audio track. It does not create transitions, effects, multicam structures, captions, or nested sequences.
- Sequence dimensions are 1920×1080. The frame rate is selected before generation and must match the intended Premiere sequence/source workflow. NTSC rates use the XMEML `timebase`/`ntsc` pairs documented by Apple.
- Source media is referenced in place through file URLs. VOD Search does not copy, transcode, trim, or modify source files.
- Missing media blocks export instead of producing knowingly offline clip references.
- Premiere may show an FCP translation report. The JSON sidecar remains the authoritative reproducible cut plan if a Premiere version translates a field differently.
