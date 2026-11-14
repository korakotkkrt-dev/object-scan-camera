# SlopeScan 3D — mobile browser prototype

Static HTTPS web prototype for live camera capture, OpenCV.js ORB feature matching, essential-matrix pose recovery, pairwise triangulation, and Three.js sparse point cloud preview. **No installation, gallery writes, uploads, or export.**

## Honest limitations

- **Not a Polycam replacement or global SLAM.** Each successful frame pair is triangulated independently; only the latest pair is displayed. There is no accumulated global map, loop closure, dense reconstruction, depth sensor, or metric scale.
- OpenCV.js browser builds may differ in exposed APIs/signatures; test `findEssentialMat`, `recoverPose`, `triangulatePoints`, and `BFMatcher` on target Safari before considering this stable.
- Requires HTTPS and a camera permission grant; uses public CDN scripts and internet connectivity.
- Camera-only geometry is in arbitrary relative units. Never use for engineering measurement without calibration, scale control, and validation.
- OpenCV and Three.js processing may be slow on older phones.

## Deploy

Replace the root files `index.html`, `style.css`, and `app.js` in the existing GitHub Pages repository. Configure Pages to serve the root of the default branch. Allow deployment to finish, then reload the HTTPS Pages URL.

## Next engineering milestone

Implement persistent feature tracks, calibrated intrinsics, multi-view camera registration, bundle adjustment, triangulation into a common coordinate frame, outlier rejection, and robust scale/GCP workflow. A server-side COLMAP/ODM pipeline is preferable for reliable dense reconstruction.
