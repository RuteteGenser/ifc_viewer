# Argus v1 release checklist (manual)

Things the automated suite cannot prove. Run this on real devices after the last deploy.
Date: ________  Build / commit: ________  Tester: ________

Automated first: `tests/run-all.sh` is green (or every failure is understood and accepted), and `tests/run-all.sh --hook --e2e-only navigation` ran.

## Real iPhone (Safari)
- [ ] Open the site, enter the basic-auth login once; the app opens and shows the empty state. Pass [ ] Fail [ ]
- [ ] Share > Add to Home Screen. Icon is the Argus eye, name is "Argus". Launch from the icon: full screen, no Safari bars. [ ]
- [ ] Top of the header is not under the notch / status bar; the bottom controls clear the home indicator (safe areas), portrait and landscape. [ ]
- [ ] "Open IFC file": the Files picker lets you pick a .ifc (and an .ifczip). A file from iCloud Drive that is not downloaded yet still opens. [ ]
- [ ] Sample building loads and looks right. Library model (FZK) opens from "My models". [ ]
- [ ] One-finger drag orbits around the point you touch. Two-finger pinch zooms and stops at the limits with the toast. Two-finger drag pans. Feels smooth, no page scroll or rubber-banding behind the model. [ ]
- [ ] Tap an element: details sheet opens, storey elevation is in metres. Drag the sheet up/down. [ ]
- [ ] Measure: two taps give a length. Section from Views. Hide + Undo. [ ]
- [ ] Swipe back from the left edge inside the viewer: "Leave the viewer?" appears. Stay keeps the model. [ ]
- [ ] Airplane mode after one visit, kill the app, relaunch from the home icon: app opens, sample opens. [ ]
- [ ] Large file (the 13 MB Clinic and the 17 MB Duplex MEP from the library): loads without the page reloading or "A problem occurred" from Safari (memory), and the model can still be rotated afterwards. [ ]
- [ ] Rotate the phone while a model is open: layout recovers, nothing is cut off. [ ]

## Real Android (Chrome)
- [ ] Menu > Install app (or Add to Home screen). Maskable icon is not cropped badly; launches standalone. [ ]
- [ ] File picker lists .ifc files (no greyed-out files). [ ]
- [ ] Pinch / orbit / pan as on iPhone; system Back gesture asks "Leave the viewer?". [ ]
- [ ] Offline relaunch from the icon opens the sample. [ ]
- [ ] Large file (Clinic 13 MB) loads, tab is not killed. [ ]

## iPad / desktop browsers
- [ ] iPad portrait and landscape: drawer / panels usable, pinch works. [ ]
- [ ] Desktop Chrome, Firefox and Safari: open, orbit with mouse, wheel zoom stops at the limits, right-click section. [ ]

## Content and wording
- [ ] Landing page: both buttons work from a phone; no horizontal scroll. [ ]
- [ ] Error messages read well: open an empty file, a .txt, and a text file renamed .ifc. [ ]
- [ ] No "Retry"/"try again" dead ends when a load fails (message names the file and what is wrong). [ ]

## Data and operations
- [ ] Backup verified: `/opt/ifc-viewer-host/api/backup.sh` ran today; newest dir in `/opt/ifc-viewer-host/backups/` has `ifc.db` and 4+ model files; `node /opt/ifc-viewer-host/api/verify.mjs` exits 0. [ ]
- [ ] Restore rehearsed once on a scratch copy (README "Integrity and backups"). [ ]
- [ ] `curl -u ifc:123 http://localhost:3700/api/health` says ok; `tests/api/run.sh --smoke` passes. [ ]
- [ ] Disk has headroom (`/api/stats` free disk above the 5 GB floor; the real 100 GB cap is not near). [ ]
- [ ] Basic-auth password is the one you intend to ship (default `ifc:123` is a placeholder). [ ]
- [ ] Adopt steps done (hardened API unit + backup timer, see api/README "Install"); `systemctl status ifc-viewer-api` and the backup timer are active. [ ]
- [ ] Rollback known: previous site dir / `redeploy.sh` rollback path written down and tried once. [ ]

Sign-off: ________  Ship / hold: ________
