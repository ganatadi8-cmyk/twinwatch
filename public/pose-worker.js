/* MediaPipe inference runs away from the interface thread. */
importScripts('/mediapipe/vision_bundle.js');
let detector;
self.onmessage = async ({data}) => {
  try {
    if(data.type === 'init') {
      const files = await Vision.FilesetResolver.forVisionTasks('/mediapipe/wasm');
      detector = await Vision.PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task', delegate: 'CPU' },
        runningMode: 'VIDEO', numPoses: 1,
        minPoseDetectionConfidence: 0.55, minPosePresenceConfidence: 0.55,
        minTrackingConfidence: 0.55, outputSegmentationMasks: false,
        canvas: new OffscreenCanvas(640, 480)
      });
      self.postMessage({type:'ready'});
    } else if(data.type === 'frame') {
      try {
        const result = detector.detectForVideo(data.bitmap, data.stamp);
        self.postMessage({type:'result',id:data.id,landmarks:result.landmarks[0] || [],world:result.worldLandmarks[0] || []});
      } finally { data.bitmap.close(); }
    }
  } catch(error) {
    self.postMessage({type:'error',id:data.id,message:error instanceof Error ? error.message : 'Pose analysis failed.'});
  }
};
