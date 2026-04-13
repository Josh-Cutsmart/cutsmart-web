# Desktop-to-Web Parity Matrix

## Scope
- Source of truth: Qt desktop implementation under `src/cutsmart/qtui/screens`.
- Goal: match visual system, workflow behavior, role permissions, and data semantics on web.

## Global Tokens (Desktop)
- App background: `#F5F5F7`
- Card background: `#FFFFFF`
- Text main: `#111111`
- Text muted: `#6E6E73`
- Border: `#E5E5EA`
- Accent: `#007AFF`

## Slice Status
- Dashboard: `in_progress` (visual + filtering/sorting parity pass landed)
- Project Details: `in_progress` (desktop tab order + status control + summary panels landed)
- Sales: `in_progress` (desktop structure pass landed: nav rail + warning + rooms/product/extras cards)
- Initial Cutlist: `pending`
- Production Cutlist: `pending`
- Company/User Settings: `pending`

## Dashboard Parity Checklist
- [x] 4 stat cards with desktop labels and hierarchy
- [x] Search field copy and placement (`Search projects...`)
- [x] Sort modes: Latest, Oldest, A-Z, Z-A
- [x] Quick status filters: All, Active, Completed
- [x] Staff and status filters
- [x] Desktop-like project row columns
- [x] Status pill color mapping based on desktop defaults
- [x] Completed projects sorted after open projects
- [x] Firestore schema alignment (`companies/{companyId}/memberships`, `companies/{companyId}/jobs`)

## Next Slice (Project Details)
- [x] Match desktop tab structure and ordering
- [x] Match status edit UX and allowed transitions (web status picker with Firestore update)
- [x] Match changelog row format and timestamps
- [x] Match media/files summary behavior
- [ ] Match permissions editor behavior by role

## Validation Protocol
1. Open desktop and web side-by-side on same account/project.
2. Compare spacing, fonts, labels, filters, and row ordering.
3. Verify each action mutates the same Firestore docs.
4. Verify role restrictions for owner/admin/staff on both clients.
5. Log deltas and fix before moving to next slice.
