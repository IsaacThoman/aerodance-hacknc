Test image downloaded from Google's MediaPipe sample asset distribution:
https://storage.googleapis.com/mediapipe-assets/pose.jpg

Used solely as a reproducible browser inference fixture. Browser tests draw two
copies into a local synthetic camera stream and run the bundled MediaPipe models.
This tests runtime integration and region slots, not real duet accuracy or hardware
latency. MediaPipe source and license: https://github.com/google-ai-edge/mediapipe
