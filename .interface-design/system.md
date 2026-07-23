# Interface System

## Direction
- A compact editorial workstation: calm, technical, and information-first.
- Prefer persistent work areas, rows, and dividers over collections of floating cards.
- Keep the video workspace immersive enough for review without hiding the transcript.

## Typography
- Use compact 12-14px interface copy and reserve larger type for page identity only.
- Use the mono face for timestamps, paths, counts, and processing details.
- Keep descriptions short; disclose detail only where it helps make a decision.

## Color
- Use matte neutral surfaces with a restrained green accent.
- Reserve the accent for selection, playback position, healthy state, and primary actions.
- Use red only for failures or destructive state.

## Surfaces
- Separate regions with crisp 1px dividers and subtle tonal shifts.
- Avoid shadows and rounded containers unless elevation or grouping is meaningful.
- Use a consistent 6-8px radius for controls and media frames.

## Interaction
- Navigation and view changes are immediate and preserve the working context.
- Opening a video preserves its originating library or search-results state so Back returns to that exact context.
- First-run onboarding is a short readiness checklist with one clear folder action, not a wizard or marketing page.
- Shared-folder publishing is explicit and per source; importing compatible shared metadata is automatic.
- Timeline and transcript timestamps always seek the video directly.
- The transcript follows playback by highlighting the active segment and scrolling only when it leaves a comfortable reading band.
- Transcript speaker labels are compact assignment controls; changing one labels the full detected voice cluster without interrupting playback review.
- Search results lead with matching transcript context, show a synopsis only when it adds distinct information, and collapse equivalent search/summary markers.
- Search results apply an adaptive confidence cutoff, group matches by video, cluster nearby moments, and disclose lower-confidence matches on request.
- Clearing a search is an explicit return to All videos; the input clear action, Escape key, and empty submission all restore the indexed-library view.
- Query-term highlighting is tolerant of light transcription errors but never treats short incidental substrings as matches.
- A video opened from search keeps the query and previous/next match controls visible; it starts with search markers only and lets the user opt into topic markers.
- Query-matching transcript rows use a secondary right-edge treatment so they remain distinct from the active playback row.
- Opening a search result in the app remains the full-row primary action; file and external-player actions live in a compact overflow menu.
- Timestamp-aware external playback prefers an installed seek-aware player and otherwise opens a generated 30-second clip in the system player.
- Clip export always exposes the exact range, offers an in-player preview, and asks where to save the resulting MP4.
- Clip creation has two explicit outcomes: export the source crop directly or carry the selected range and transcript into Short form.
- Clip creation around a search result chooses context symmetrically before and after the current playhead; the Short-form editor owns the final cut.
- Short-form editing is a three-part workstation: source-region selection, a dominant 9:16 output preview, and a compact caption/export inspector.
- Short-form trimming keeps a recoverable source-context window and uses one traditional editorial ruler: the playhead rail and draggable In/Out range share an identical horizontal scale, with Set in/Set out actions directly beneath it. Preview and export use only the final selected range.
- Source crops use normalized draggable regions, while width and height controls provide precise adjustment. Preview and export share the same cover-fit geometry so neither content nor face cam is stretched.
- Caption styling is global and immediately visible; transcript phrase edits remain secondary and dense beneath the style controls.
- Native video controls remain available as a reliable playback and scrubbing baseline.
- Display titles remove file extensions, date prefixes, and source IDs; preserve the original filename or path as secondary detail and hover text.
- Activity pairs the current queue with compact history and an adjacent Schedule view, explains each job state in plain language, shows useful timing, and exposes only the currently valid Pause or Resume action. Avoid duplicating queue totals in a separate status-summary strip.
- Speaker review is a cross-library inbox: show transcript evidence and an exact media timestamp before assignment, then remove confirmed rows immediately.
- Speaker-review rows keep both paths available: open the full video at the evidence timestamp or play only that detected voice turn inline. Audio previews are exclusive, bounded, and never navigate away from the inbox.
- Source actions live in an overflow menu. Removing a source requires confirmation and removes only the local index, never the user’s media files.
- Processing schedules live in Activity as a fourth view beside Active, History, and All. Use one compact row per pipeline phase, show whether each window is open and its next start, and explain schedule holds on queued rows.
- Motion is brief and structural; avoid decorative movement.

## Components
- Buttons and fields are 32-36px tall by default.
- Library and queue content use dense, full-width rows with predictable columns.
- Settings use aligned labels and controls rather than self-contained cards.
- Status badges are compact and secondary to the primary content.

## Avoid
- Metric-card dashboards, nested cards, and oversized empty space.
- Repeating the same metadata in multiple nearby places.
- Tabbed media details that force the player and transcript to be viewed separately.
- Large icon tiles, heavy shadows, and pill-shaped containers for ordinary content.
